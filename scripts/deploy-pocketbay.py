#!/usr/bin/env python3
"""
PocketBay 一键部署脚本（零第三方依赖，仅需 Python 3.10+ 标准库）
严格遵循 https://pocketbay.com/api/deploy/instructions 协议：
1. 自动创建 PocketBay 配对会话并打开浏览器确认页
2. 等待网页授权确认（支持保存 30 天信任设备凭证至 ~/.pocketbay/credentials.json）
3. 自动打包项目源码（排除 node_modules/.git/.next/data，仅打包配对页批准的配置文件）
4. 支持 source-baseline 清单校验上传并轮询至 running 状态，输出公网 *.pocketbay.app 访问地址
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
import zipfile
from pathlib import Path

PLATFORM_URL = "https://pocketbay.com"
SUGGESTED_NAME = "zhizhaocesuo"

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    ".turbo",
    ".vercel",
    "dist",
    "build",
    "out",
    "coverage",
    "data",
}

EXCLUDED_SUFFIXES = (".db", ".db-shm", ".db-wal", ".log", ".pem", ".tsbuildinfo", ".zip")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def api_json(
    method: str,
    path: str,
    token: str | None = None,
    payload: dict | None = None,
    timeout: int = 30,
) -> tuple[int, dict]:
    url = f"{PLATFORM_URL}{path}"
    headers = {"Accept": "application/json", "User-Agent": "PocketBayDeployHelper/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"detail": raw}


def encode_multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"----PocketBayBoundary{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for k, v in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        chunks.append(str(v).encode("utf-8"))
        chunks.append(b"\r\n")

    for field_name, (filename, content, content_type) in files.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode()
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        chunks.append(content)
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def save_device_token(device_token: str, label: str = "LocalScript") -> None:
    cred_path = Path.home() / ".pocketbay" / "credentials.json"
    cred_path.parent.mkdir(parents=True, exist_ok=True)
    store: dict = {}
    if cred_path.exists():
        try:
            store = json.loads(cred_path.read_text(encoding="utf-8"))
        except Exception:
            store = {}
    platform_entry = store.get(PLATFORM_URL, {})
    if not isinstance(platform_entry, dict):
        platform_entry = {}
    platform_entry["_device"] = {"token": device_token, "label": label}
    store[PLATFORM_URL] = platform_entry
    cred_path.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(cred_path, 0o600)
    except Exception:
        pass


def build_project_zip(repo_root: Path, approved_configs: set[str], out_zip: Path) -> None:
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(repo_root):
            rel_dir = Path(root).relative_to(repo_root)
            dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

            for fname in files:
                if fname == ".DS_Store" or fname.endswith(EXCLUDED_SUFFIXES):
                    continue
                rel_path = (rel_dir / fname).as_posix() if str(rel_dir) != "." else fname

                # 过滤敏感 .env 文件：仅打包配对页批准的相对路径（保留公开模板 .env.example）
                if fname.startswith(".env") and fname != ".env.example":
                    if rel_path not in approved_configs:
                        continue

                full_file = Path(root) / fname
                if not full_file.is_file() or full_file.is_symlink():
                    continue

                info = zipfile.ZipInfo(rel_path)
                st = full_file.stat()
                info.date_time = time.localtime(st.st_mtime)[:6]
                mode = 0o755 if (st.st_mode & 0o111) else 0o644
                info.external_attr = (mode & 0xFFFF) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, full_file.read_bytes())


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    print(f"[1/5] 检查项目根目录: {repo_root}")

    config_files = []
    env_local = repo_root / ".env.local"
    if env_local.is_file():
        config_files.append(
            {
                "path": ".env.local",
                "size": env_local.stat().st_size,
                "sha256": sha256_file(env_local),
                "sensitive": True,
                "usage_phase": "build_and_runtime",
                "upload_mode": "package",
            }
        )

    session_payload = {
        "suggested_name": SUGGESTED_NAME,
        "agent_label": "DeployHelper",
        "client_ide": "other",
        "client_llm": "other",
        "config_files": config_files,
        "product_candidates": [],
        "database_facts": {
            "kind": "sqlite",
            "engine": "sqlite",
            "evidence": ["lib/db.ts"],
            "migration": {"owner": "application"},
        },
    }

    print("[2/5] 正在创建 PocketBay 配对会话...")
    code, sess = api_json("POST", "/api/deploy/sessions", payload=session_payload)
    if code not in (200, 201) or "device_secret" not in sess:
        print(f"创建配对会话失败 (HTTP {code}): {sess}", file=sys.stderr)
        return 1

    device_secret = sess["device_secret"]
    pairing_url = sess["pairing_url"]

    print("\n请在浏览器打开以下配对链接确认项目名与配置（在网页点完即可，脚本会自动继续）：\n")
    print(pairing_url)
    print("")
    try:
        webbrowser.open(pairing_url)
    except Exception:
        pass

    print("[3/5] 正在等待网页端确认授权...")
    auth_data: dict = {}
    deadline = time.time() + 600
    while time.time() < deadline:
        w_code, w_body = api_json("GET", "/api/deploy/sessions/wait?timeout=15", token=device_secret, timeout=25)
        status = w_body.get("status")
        if status == "waiting":
            continue
        if status == "pending" and w_body.get("action_required") == "wait_for_interaction":
            print(f"请在配对页完成待确认项：{pairing_url}")
            time.sleep(3)
            continue
        if status == "authorized":
            auth_data = w_body
            break
        print(f"配对未通过或已过期 (HTTP {w_code}): {w_body}", file=sys.stderr)
        return 1
    else:
        print("等待配对超时（10分钟），请重新运行脚本。", file=sys.stderr)
        return 1

    if auth_data.get("device_token"):
        save_device_token(auth_data["device_token"])

    approved_configs = set(auth_data.get("approved_config_paths") or [])
    print(f"授权成功！目标项目标识: {auth_data.get('project_slug')}")

    with tempfile.TemporaryDirectory(prefix="pocketbay_") as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)
        full_zip = tmp_dir / "FULL.zip"
        print("[4/5] 正在打包应用源码...")
        build_project_zip(repo_root, approved_configs, full_zip)

        upload_zip = full_zip
        fields: dict[str, str] = {}
        files_part: dict[str, tuple[str, bytes, str]] = {}

        # 检查平台 source-baseline 清单协议
        b_code, baseline = api_json("GET", "/api/deploy/sessions/source-baseline", token=device_secret)
        if b_code == 200 and baseline.get("protocol_version") == 1:
            tool_req = urllib.request.Request(
                f"{PLATFORM_URL}/api/deploy/source-tool.py",
                headers={"User-Agent": "PocketBayDeployHelper/1.0"},
            )
            with urllib.request.urlopen(tool_req, timeout=20) as r:
                tool_code = r.read()
            tool_py = tmp_dir / "source-tool.py"
            baseline_json = tmp_dir / "baseline.json"
            patch_zip = tmp_dir / "PATCH.zip"
            request_json = tmp_dir / "request.json"
            tool_py.write_bytes(tool_code)
            baseline_json.write_text(json.dumps(baseline), encoding="utf-8")

            subprocess.run(
                [sys.executable, str(tool_py), str(full_zip), str(baseline_json), str(patch_zip), str(request_json)],
                check=True,
            )
            req_meta = json.loads(request_json.read_text(encoding="utf-8"))
            upload_zip = Path(req_meta["upload_file"])
            fields["mode"] = str(req_meta["mode"])
            if req_meta.get("base_revision") is not None:
                fields["base_revision"] = str(req_meta["base_revision"])
            if req_meta.get("base_deployment_id"):
                fields["base_deployment_id"] = str(req_meta["base_deployment_id"])
            files_part["manifest_json"] = (
                "manifest_json.json",
                json.dumps(req_meta["manifest"]).encode("utf-8"),
                "application/json",
            )
            if req_meta.get("mode") == "incremental" and "diff" in req_meta:
                deleted = req_meta["diff"].get("deleted", [])
                files_part["deleted_paths_json"] = (
                    "deleted_paths.json",
                    json.dumps(deleted).encode("utf-8"),
                    "application/json",
                )

        files_part["file"] = (upload_zip.name, upload_zip.read_bytes(), "application/zip")
        body_bytes, content_type = encode_multipart(fields, files_part)

        print("正在上传构建包至 PocketBay...")
        up_req = urllib.request.Request(
            f"{PLATFORM_URL}/api/deploy/sessions/upload",
            data=body_bytes,
            headers={
                "Authorization": f"Bearer {device_secret}",
                "Content-Type": content_type,
                "Accept": "application/json",
                "User-Agent": "PocketBayDeployHelper/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(up_req, timeout=120) as resp:
                _ = resp.read()
        except urllib.error.HTTPError as e:
            err_txt = e.read().decode("utf-8", errors="replace")
            print(f"上传失败 (HTTP {e.code}): {err_txt}", file=sys.stderr)
            return 1

    print("[5/5] 已进入平台构建与健康检查，正在轮询上线状态...")
    while True:
        time.sleep(4)
        s_code, st = api_json("GET", "/api/deploy/sessions/status", token=device_secret)
        if s_code != 200:
            continue

        next_action = st.get("next_action")
        proj_status = st.get("project_status")
        is_failed = st.get("is_failed", False)

        if next_action == "done" and proj_status == "running" and not is_failed:
            msg_map = st.get("success_message")
            if isinstance(msg_map, dict) and msg_map.get("zh-CN"):
                print("\n" + msg_map["zh-CN"])
            elif isinstance(msg_map, str) and msg_map:
                print("\n" + msg_map)
            else:
                url = st.get("url", "")
                console_url = st.get("console_url", f"{PLATFORM_URL}/dashboard")
                print(
                    f"\n部署成功！你的应用已在 PocketBay 上线。\n\n"
                    f"应用访问地址：{url}\n\n"
                    f"PocketBay 项目控制台：{console_url}\n"
                )
            return 0

        if is_failed or next_action in ("fix_and_redeploy", "wait_for_config_upload", "wait_for_database"):
            print(
                f"\n部署未完成: category={st.get('error_category')} "
                f"hint={st.get('repair_hint')}\n详情: {json.dumps(st, ensure_ascii=False, indent=2)}",
                file=sys.stderr,
            )
            return 1

        print(f"  当前状态: project_status={proj_status}, next_action={next_action} ...")


if __name__ == "__main__":
    raise SystemExit(main())

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

export default function SettingsPage() {
  const router = useRouter();
  const { user, refreshSession, authFetch } = useAuth();

  const [nickname, setNickname] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
    }
  }, [user]);

  const handleUpdateNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await authFetch('/api/v1/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
      const json = await res.json();
      if (json.code === 200) {
        await refreshSession();
        toast.success('昵称已更新');
      } else {
        toast.error(json.message || '修改失败');
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSavingPwd(true);
    try {
      const res = await authFetch('/api/v1/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      const json = await res.json();
      if (json.code === 200) {
        setPasswords({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        toast.success('密码修改成功');
      } else {
        toast.error(json.message || '密码修改失败');
      }
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12 space-y-5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => router.push('/me')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-extrabold text-slate-900">账号设置</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
      {/* 修改昵称 */}
      <form
        onSubmit={handleUpdateNickname}
        className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3.5"
      >
        <h2 className="text-sm font-bold text-slate-800">个人资料</h2>
        <div>
          <label className="block text-xs text-slate-500 mb-1">登录账号（唯一不可改）</label>
          <input
            type="text"
            disabled
            value={user?.username || ''}
            className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">显示昵称</label>
          <input
            type="text"
            required
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={savingProfile}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
        >
          {savingProfile ? '保存中...' : '保存昵称'}
        </button>
      </form>

      {/* 修改密码 */}
      <form
        onSubmit={handleUpdatePassword}
        className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3.5"
      >
        <h2 className="text-sm font-bold text-slate-800">修改登录密码</h2>
        <div>
          <label className="block text-xs text-slate-600 mb-1">当前原密码</label>
          <input
            type="password"
            required
            value={passwords.currentPassword}
            onChange={(e) =>
              setPasswords({ ...passwords, currentPassword: e.target.value })
            }
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">新密码（至少6位）</label>
          <input
            type="password"
            required
            minLength={6}
            value={passwords.newPassword}
            onChange={(e) =>
              setPasswords({ ...passwords, newPassword: e.target.value })
            }
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">确认新密码</label>
          <input
            type="password"
            required
            minLength={6}
            value={passwords.confirmPassword}
            onChange={(e) =>
              setPasswords({ ...passwords, confirmPassword: e.target.value })
            }
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={savingPwd}
          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
        >
          {savingPwd ? '更新中...' : '确认修改密码'}
        </button>
      </form>
      </div>
    </div>
  );
}

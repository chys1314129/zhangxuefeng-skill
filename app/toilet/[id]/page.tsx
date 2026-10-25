'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Compass,
  Edit3,
  Lock,
  MapPin,
  Navigation,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import CommentBoard from '@/components/Comment/CommentBoard';
import InteractiveMap from '@/components/Map/InteractiveMap';
import NavigationModal from '@/components/Toilet/NavigationModal';
import PhotoGallery from '@/components/Toilet/PhotoGallery';
import { useAuth } from '@/hooks/useAuth';
import { useUserLocation } from '@/hooks/useUserLocation';
import {
  formatDistance,
  haversineDistance,
} from '@/lib/geo';
import { getInferredCategoryMeta } from '@/lib/inferredVenues';
import {
  fetchShortestWalkingRouteClient,
  formatWalkMinutes,
  type WalkingRouteDetail,
} from '@/lib/routeService';
import type { ToiletItem } from '@/types';

export default function ToiletDetailPage() {
  const params = useParams<{ id: string }>();
  const toiletId = params.id;
  const router = useRouter();
  const { user, authFetch } = useAuth();
  const { location } = useUserLocation();

  const [navOpen, setNavOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [voting, setVoting] = useState(false);
  const [routeDetail, setRouteDetail] = useState<WalkingRouteDetail | null>(
    null
  );
  const [editForm, setEditForm] = useState({
    name: '',
    floor: '',
    openingHours: '',
    description: '',
    isFree: true,
    hasPaper: true,
    hasAccessible: false,
  });

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  const { data, isLoading, mutate } = useSWR(
    [`/api/v1/toilets/${toiletId}`, user?.id || 'guest'],
    async ([url]) => {
      const res = await authFetch(url);
      return res.json();
    }
  );

  const toilet: ToiletItem | null = data?.data?.toilet || null;

  useEffect(() => {
    setRouteDetail(null);
    if (!toilet || !location || !location.inChina) return;

    let cancelled = false;
    fetchShortestWalkingRouteClient(
      location.lng,
      location.lat,
      toilet.lng,
      toilet.lat,
      toilet.id
    ).then((res) => {
      if (!cancelled && res) {
        setRouteDetail(res);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [toilet?.id, toilet?.lng, toilet?.lat, location?.lng, location?.lat, location?.inChina]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 pt-16 text-center text-slate-400 text-sm">
        正在加载厕所详情...
      </div>
    );
  }

  if (!toilet) {
    return (
      <div className="max-w-md mx-auto px-4 pt-20 text-center">
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-xs">
          <div className="text-4xl mb-3">🕵️</div>
          <h2 className="text-lg font-bold text-slate-800">
            未找到该厕所或属于他人私人标记
          </h2>
          <p className="text-xs text-slate-500 mt-2">
            无照片的私人标记仅创建者本人可见
          </p>
          <Link
            href="/"
            className="mt-5 inline-block px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl"
          >
            返回地图找厕所
          </Link>
        </div>
      </div>
    );
  }

  const straightDist = location
    ? haversineDistance(location.lng, location.lat, toilet.lng, toilet.lat)
    : undefined;
  const distance = routeDetail?.distance ?? straightDist;
  const walkDuration = routeDetail?.duration;
  const isRouteDistance = Boolean(routeDetail);
  const toiletWithDist: ToiletItem = {
    ...toilet,
    straightDistance: straightDist,
    distance,
    walkDuration,
    isRouteDistance,
  };

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const canManage = Boolean(toilet.isOwn || isAdmin);
  const isInferred = toilet.source === 'INFERRED';
  const inferredMeta = isInferred
    ? getInferredCategoryMeta(toilet.inferredCategory)
    : null;

  const handleVoteVerification = async (
    voteType: 'AVAILABLE' | 'UNAVAILABLE'
  ) => {
    if (!user) {
      toast('请先登录再提交现场核实反馈', {
        action: {
          label: '去登录',
          onClick: () => router.push('/login'),
        },
      });
      return;
    }

    setVoting(true);
    try {
      const res = await authFetch(`/api/v1/toilets/${toilet.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: voteType }),
      });
      const json = await res.json();
      if (json.code === 200) {
        toast.success(json.data?.message || '反馈成功');
        mutate();
      } else {
        toast.error(json.message || '提交反馈失败');
      }
    } catch {
      toast.error('网络异常，请重试');
    } finally {
      setVoting(false);
    }
  };

  const openEditModal = () => {
    setEditForm({
      name: toilet.name,
      floor: toilet.floor || '',
      openingHours: toilet.openingHours || '',
      description: toilet.description || '',
      isFree: toilet.isFree,
      hasPaper: toilet.hasPaper === true,
      hasAccessible: toilet.hasAccessible === true,
    });
    setEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      const res = await authFetch(`/api/v1/toilets/${toilet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (json.code === 200) {
        toast.success(json.message || '已更新');
        setEditing(false);
        mutate();
      } else {
        toast.error(json.message || '保存失败');
      }
    } catch {
      toast.error('网络异常');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteToilet = async () => {
    if (!window.confirm(`确定要删除「${toilet.name}」吗？此操作不可撤销。`)) {
      return;
    }
    const res = await authFetch(`/api/v1/toilets/${toilet.id}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.code === 200) {
      toast.success('已删除该厕所标记');
      router.push('/');
    } else {
      toast.error(json.message || '删除失败');
    }
  };

  const handleAdminQuickApprove = async () => {
    const res = await authFetch(`/api/v1/admin/toilets/${toilet.id}/approve`, {
      method: 'POST',
    });
    const json = await res.json();
    if (json.code === 200) {
      toast.success(
        json.message || '🛡️ 管理员实地验证通过，该点位现已对所有人公开！'
      );
      mutate();
    } else {
      toast.error(json.message || '操作失败');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12 space-y-4">
      {/* 顶部返回与管理栏 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex items-center gap-2">
          <Link
            href={`/?lng=${toilet.lng}&lat=${toilet.lat}`}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs sm:text-sm font-medium hover:bg-slate-50 transition"
          >
            <MapPin className="w-3.5 h-3.5 text-blue-600" />
            在地图定位
          </Link>

          {isAdmin &&
            !isInferred &&
            toilet.status === 'PUBLIC' &&
            !toilet.adminVerified && (
              <button
                type="button"
                onClick={handleAdminQuickApprove}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs sm:text-sm font-semibold hover:bg-emerald-100 transition"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                标记本人已核验
              </button>
            )}

          {canManage && (
            <>
              <button
                type="button"
                onClick={openEditModal}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs sm:text-sm font-medium hover:bg-slate-50 transition"
              >
                <Edit3 className="w-3.5 h-3.5" />
                编辑
              </button>
              <button
                type="button"
                onClick={handleDeleteToilet}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs sm:text-sm font-medium hover:bg-red-100 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </button>
            </>
          )}
        </div>
      </div>

      {/* 推测可借用场所醒目免责声明与核实指引横幅 */}
      {isInferred && inferredMeta && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start justify-between gap-3 text-xs sm:text-sm text-amber-900 shadow-sm flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-[240px]">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-extrabold text-amber-950 flex items-center gap-1.5 flex-wrap">
                <span>⚠️ 推测可能可借用场所（尚未实拍确认）</span>
                <span className="text-[11px] font-bold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
                  {inferredMeta.emoji} {inferredMeta.label}
                </span>
              </div>
              <p className="text-amber-800 text-xs leading-relaxed">
                此点位由系统根据场所类型智能标出，<strong>仅代表可能存在对外开放的免费卫生间</strong>，受营业时间与现场管理规定影响。最终确认请参考下方网友现场反馈与留言；如您亲临现场发现可用，<strong>上传一张实拍照片即可通过自动审核秒变「正式公开公厕」</strong>！
              </p>
              {toilet.inferredHidden && (
                <p className="text-red-700 font-semibold text-xs pt-0.5">
                  🚫 当前已有多位用户反馈“无厕所或不对外”，系统已自动从地图隐藏该点位。
                </p>
              )}
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminQuickApprove}
              className="shrink-0 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm inline-flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              本人已验证 · 免审直接转正公开
            </button>
          )}
        </div>
      )}

      {/* 可见性状态横幅 */}
      {toilet.status === 'PRIVATE' && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs sm:text-sm text-purple-800 flex-wrap">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div>
              <strong>私人标记 · 仅你自己可见</strong>
              <p className="mt-0.5 text-purple-600 text-xs">
                由于添加时未上传照片，此厕所仅显示在你的地图上。在下方补拍照片后即可提交公开审核！
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminQuickApprove}
              className="shrink-0 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              本人已验证 · 免审直接公开
            </button>
          )}
        </div>
      )}

      {toilet.status === 'PENDING' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs sm:text-sm text-amber-800 flex-wrap">
          <div>
            <strong>⏳ 待审核状态 · 审核通过后全网公开</strong>
            <p className="mt-0.5 text-amber-700 text-xs">
              管理员核实位置或照片真实性后将面向所有用户展示。
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminQuickApprove}
              className="shrink-0 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              跳过审核 · 直接公开
            </button>
          )}
        </div>
      )}

      {toilet.status === 'REJECTED' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 flex-wrap">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong>
                审核未通过：{toilet.rejectedReason || '请补充清晰实景图'}
              </strong>
              <p className="mt-0.5 text-red-600 text-xs">
                您可以点击「编辑」修改信息或在下方重新上传清晰照片，系统将自动重新提交审核。
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminQuickApprove}
              className="shrink-0 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              本人已验证 · 直接公开
            </button>
          )}
        </div>
      )}

      {/* 手机端单列上下排布 / 电脑端左右双栏排布 (左：详情+地图+照片，右：实时留言板) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左栏：基础信息 + 迷你地图 + 现场核实投票 + 实景照片 */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4 sm:p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {isInferred && inferredMeta ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-500 text-white px-2.5 py-0.5 rounded-full">
                    <Compass className="w-3.5 h-3.5" />
                    {inferredMeta.emoji} 推测可能·未核实 ({inferredMeta.shortLabel})
                  </span>
                ) : (
                  toilet.status === 'PUBLIC' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {toilet.adminVerified
                        ? '🛡️ 管理员实地核验公开'
                        : toilet.source === 'AMAP'
                          ? '高德官方实时POI'
                          : '已通过实景审核公开'}
                    </span>
                  )
                )}
                {toilet.floor && (
                  <span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full">
                    楼层：{toilet.floor}
                  </span>
                )}
              </div>

              <h1 className="text-xl font-extrabold text-slate-900 leading-snug">
                {toilet.name}
              </h1>

              {/* 评分 + 距离 */}
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  {toilet.avgRating > 0
                    ? `${toilet.avgRating.toFixed(1)} 分`
                    : '暂无评分'}
                  <span className="text-slate-400 font-normal">
                    ({toilet.commentCount}条留言)
                  </span>
                </span>

                {distance !== undefined && location?.inChina && (
                  <span className="text-blue-600 font-semibold">
                    {isRouteDistance ? '最短步行路线 ' : '参考距离 '}
                    {formatDistance(distance)} · 步行约{' '}
                    {formatWalkMinutes(walkDuration, distance)} 分钟
                  </span>
                )}
              </div>
            </div>

            {/* 标签栏 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
                  toilet.isFree
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {toilet.isFree ? '🆓 免费使用' : '💰 需消费/收费'}
              </span>

              {toilet.hasPaper === true && (
                <span className="text-xs px-2.5 py-1 rounded-lg font-medium bg-blue-50 text-blue-700">
                  🧻 提供厕纸
                </span>
              )}
              {toilet.hasPaper === false && (
                <span className="text-xs px-2.5 py-1 rounded-lg font-medium bg-orange-50 text-orange-700">
                  ⚠️ 无公共厕纸（请自备）
                </span>
              )}
              {toilet.hasAccessible && (
                <span className="text-xs px-2.5 py-1 rounded-lg font-medium bg-sky-50 text-sky-700">
                  ♿ 无障碍设施
                </span>
              )}
              {toilet.openingHours && (
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium bg-slate-100 text-slate-700">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {toilet.openingHours}
                </span>
              )}
            </div>

            {/* 地址与找路指引 */}
            <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-sm">
              {toilet.address && (
                <div className="flex items-start gap-2 text-slate-700">
                  <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm">{toilet.address}</span>
                </div>
              )}
              {toilet.description && (
                <div className="text-xs sm:text-sm text-slate-600 bg-white rounded-lg p-2.5 border border-slate-200/70">
                  <span className="font-semibold text-slate-800">
                    💡 找路指引：
                  </span>
                  {toilet.description}
                </div>
              )}
              {toilet.creator && (
                <div className="text-[11px] text-slate-400">
                  由 @{toilet.creator.nickname} 标记贡献
                </div>
              )}
            </div>

            {/* 电脑端内嵌迷你位置地图预览 */}
            <div className="hidden md:block h-40 w-full rounded-xl overflow-hidden border border-slate-200">
              <InteractiveMap
                center={[toilet.lng, toilet.lat]}
                zoom={16}
                userLocation={location}
                routePath={
                  routeDetail && routeDetail.polyline.length >= 2
                    ? routeDetail.polyline
                    : null
                }
                toilets={[toiletWithDist]}
                nearestId={toilet.id}
                showZoomControls={false}
              />
            </div>

            {/* 一键步行导航大按钮 */}
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className={`w-full py-3.5 rounded-xl active:scale-[0.99] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition ${
                isInferred
                  ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
              }`}
            >
              <Navigation className="w-4 h-4" />
              {isInferred
                ? '应急步行导航到这里（未核实场所）'
                : '一键步行导航到这里'}
            </button>

            {/* 现场真实性众包快捷核实栏 */}
            <div
              className={`rounded-xl p-3.5 border space-y-2.5 ${
                isInferred
                  ? 'bg-amber-50/70 border-amber-200'
                  : 'bg-slate-50 border-slate-200/70'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  🤝 现场众包核实反馈
                </span>
                {isInferred && (
                  <span className="text-[11px] text-amber-700">
                    累计≥2人反馈无厕所将自动隐藏
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => handleVoteVerification('AVAILABLE')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition ${
                    toilet.myVote === 'AVAILABLE'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>亲测可用 ({toilet.availableVotes || 0})</span>
                </button>

                <button
                  type="button"
                  disabled={voting}
                  onClick={() => handleVoteVerification('UNAVAILABLE')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition ${
                    toilet.myVote === 'UNAVAILABLE'
                      ? 'bg-red-600 text-white border-red-600 shadow-sm'
                      : 'bg-white hover:bg-red-50 text-red-600 border-red-200'
                  }`}
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {isInferred ? '无厕所/不对外' : '暂不可用'} (
                    {toilet.unavailableVotes || 0})
                  </span>
                </button>
              </div>
            </div>

            {/* 实景照片与自动审核补传组件 */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-sm font-bold text-slate-800">
                  📷 实景照片 ({toilet.photos?.length || 0})
                </h3>
                {isInferred && (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    传照片自动审核转正
                  </span>
                )}
              </div>
              <PhotoGallery
                toiletId={toilet.id}
                status={toilet.status}
                isInferred={isInferred}
                isOwn={toilet.isOwn}
                photos={toilet.photos || []}
                onUploaded={() => mutate()}
              />
            </div>
          </div>
        </div>

        {/* 右栏：实时互助留言板 */}
        <div className="lg:col-span-7">
          <CommentBoard
            toiletId={toilet.id}
            onStatsChanged={() => mutate()}
          />
        </div>
      </div>

      {/* 导航选择弹窗 */}
      <NavigationModal
        toilet={navOpen ? toiletWithDist : null}
        userLocation={location}
        onClose={() => setNavOpen(false)}
      />

      {/* 编辑厕所弹窗 */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEditing(false)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 space-y-3.5 shadow-2xl"
          >
            <h3 className="text-base font-bold text-slate-900">编辑厕所信息</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                名称
              </label>
              <input
                type="text"
                required
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  楼层
                </label>
                <input
                  type="text"
                  value={editForm.floor}
                  onChange={(e) =>
                    setEditForm({ ...editForm, floor: e.target.value })
                  }
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  开放时间
                </label>
                <input
                  type="text"
                  value={editForm.openingHours}
                  onChange={(e) =>
                    setEditForm({ ...editForm, openingHours: e.target.value })
                  }
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-medium text-slate-700 py-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isFree}
                  onChange={(e) =>
                    setEditForm({ ...editForm, isFree: e.target.checked })
                  }
                />
                免费
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.hasPaper}
                  onChange={(e) =>
                    setEditForm({ ...editForm, hasPaper: e.target.checked })
                  }
                />
                有纸
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.hasAccessible}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      hasAccessible: e.target.checked,
                    })
                  }
                />
                无障碍
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                找路指引
              </label>
              <textarea
                rows={2}
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                {savingEdit ? '保存中...' : '保存修改'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

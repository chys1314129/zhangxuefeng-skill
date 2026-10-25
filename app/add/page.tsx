'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import PhotoUploader from '@/components/AddToilet/PhotoUploader';
import MapPicker from '@/components/Map/MapPicker';
import { useAuth } from '@/hooks/useAuth';
import { saveMapViewport } from '@/hooks/useUserLocation';

const addToiletSchema = z.object({
  name: z.string().trim().min(1, '请输入厕所名称').max(50, '名称最多50字'),
  lng: z.number({ invalid_type_error: '请在地图上选择位置' }),
  lat: z.number({ invalid_type_error: '请在地图上选择位置' }),
  address: z.string().optional(),
  isFree: z.boolean().default(true),
  hasPaper: z.boolean().optional(),
  hasAccessible: z.boolean().optional(),
  floor: z.string().max(30).optional(),
  openingHours: z.string().max(50).optional(),
  description: z.string().max(200, '描述最多200字').optional(),
});

type AddToiletFormData = z.infer<typeof addToiletSchema>;

const HOURS_PRESETS = ['24小时', '10:00-22:00', '08:00-21:00', '06:00-23:00'];
const FLOOR_PRESETS = ['1F', 'B1', '2F', '3F'];

function AddToiletContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, authFetch } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const initLng = parseFloat(searchParams.get('lng') || '');
  const initLat = parseFloat(searchParams.get('lat') || '');
  const hasExplicitCenter =
    Number.isFinite(initLng) && Number.isFinite(initLat);
  const pickerInitial: [number, number] = hasExplicitCenter
    ? [initLng, initLat]
    : [116.397428, 39.90923];

  const [photos, setPhotos] = useState<File[]>([]);
  const [directPublish, setDirectPublish] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AddToiletFormData>({
    resolver: zodResolver(addToiletSchema),
    defaultValues: {
      lng: pickerInitial[0],
      lat: pickerInitial[1],
      isFree: true,
      hasPaper: true,
      hasAccessible: false,
      address: '',
      floor: '',
      openingHours: '',
      description: '',
    },
  });

  const hasPhotos = photos.length > 0;
  const watchedIsFree = watch('isFree');
  const watchedHasPaper = watch('hasPaper');
  const watchedHasAccessible = watch('hasAccessible');
  const watchedDescription = watch('description') || '';

  if (!authLoading && !user) {
    return (
      <div className="max-w-md mx-auto px-4 pt-20 pb-24 text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="text-4xl mb-3">🔐</div>
          <h2 className="text-lg font-bold text-slate-900">
            登录后即可标记新厕所
          </h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            上传实景照片审核通过后可对所有人公开；不拍照片也可保存为「仅自己可见」的私人找厕备忘录。
          </p>
          <Link
            href="/login?redirect=/add"
            className="mt-6 inline-block w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition"
          >
            前往登录 / 注册
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(data: AddToiletFormData) {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('name', data.name);
      formData.append('lng', String(data.lng));
      formData.append('lat', String(data.lat));
      if (data.address) formData.append('address', data.address);
      formData.append('isFree', String(data.isFree));
      if (data.hasPaper !== undefined) {
        formData.append('hasPaper', String(data.hasPaper));
      }
      if (data.hasAccessible !== undefined) {
        formData.append('hasAccessible', String(data.hasAccessible));
      }
      if (data.floor) formData.append('floor', data.floor);
      if (data.openingHours) formData.append('openingHours', data.openingHours);
      if (data.description) formData.append('description', data.description);
      if (isAdmin) {
        formData.append('directPublish', String(directPublish));
      }

      photos.forEach((photo) => formData.append('photos', photo));

      const res = await authFetch('/api/v1/toilets', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();

      if (result.code === 200) {
        saveMapViewport(data.lng, data.lat, 16);
        toast.success(result.data.message);
        const createdId = result.data?.toilet?.id;
        if (createdId) {
          router.push(`/toilet/${createdId}`);
        } else {
          router.push('/');
        }
      } else {
        toast.error(result.message || '提交失败');
      }
    } catch {
      toast.error('网络异常，提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 pt-4 md:pt-6 pb-24 md:pb-12">
      {/* 顶部标题 */}
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-lg md:text-xl font-extrabold text-slate-900">
            📍 添加新厕所
          </h1>
          <p className="text-xs text-slate-500">
            随手标记救人一急 · 有照片审核公开，无照片仅自己可见
          </p>
        </div>
      </div>

      {/* 手机单列 / 电脑左右分栏表单 */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
      >
        {/* 左栏：地图精确选点 + 地址 */}
        <div className="lg:col-span-6 bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-slate-800">
              1. 选择准确位置
            </label>
            <span className="text-[11px] text-slate-400">
              支持滚轮缩放 / 点击选点 / 拖拽微调
            </span>
          </div>

          <MapPicker
            initialCenter={pickerInitial}
            hasExplicitCenter={hasExplicitCenter}
            onLocationChange={(lng, lat, address) => {
              setValue('lng', lng);
              setValue('lat', lat);
              setValue('address', address);
            }}
          />

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              街道/建筑地址（选点后自动解析，可手动微调）
            </label>
            <input
              {...register('address')}
              placeholder="街道/商场/写字楼详细地址"
              className="w-full text-xs sm:text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 右栏：厕所属性 + 照片上传 + 提交 */}
        <div className="lg:col-span-6 space-y-5">
          {/* 2. 厕所名称与属性 */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-200/80 space-y-4">
            <label className="block text-sm font-bold text-slate-800">
              2. 厕所名称与属性
            </label>

            <div>
              <input
                {...register('name')}
                placeholder="如：北京apm B1东区洗手间、星巴克二楼厕所"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.name && (
                <p className="text-red-500 text-xs mt-1">
                  {errors.name.message}
                </p>
              )}
            </div>

            {/* 属性开关卡片 */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setValue('isFree', !watchedIsFree)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-semibold transition ${
                  watchedIsFree
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="text-xl">🆓</span>
                <span>免费开放</span>
                <span className="text-[10px] font-normal">
                  {watchedIsFree ? '已开启' : '需消费/收费'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setValue('hasPaper', !watchedHasPaper)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-semibold transition ${
                  watchedHasPaper
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="text-xl">🧻</span>
                <span>提供厕纸</span>
                <span className="text-[10px] font-normal">
                  {watchedHasPaper ? '有纸' : '不确定/无纸'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setValue('hasAccessible', !watchedHasAccessible)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-semibold transition ${
                  watchedHasAccessible
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="text-xl">♿</span>
                <span>无障碍/母婴</span>
                <span className="text-[10px] font-normal">
                  {watchedHasAccessible ? '支持' : '未配置'}
                </span>
              </button>
            </div>

            {/* 楼层 + 开放时间 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  所在楼层（可选）
                </label>
                <input
                  {...register('floor')}
                  placeholder="如：B1、2F"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {FLOOR_PRESETS.map((fl) => (
                    <button
                      key={fl}
                      type="button"
                      onClick={() => setValue('floor', fl)}
                      className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded transition"
                    >
                      {fl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  开放时间（可选）
                </label>
                <input
                  {...register('openingHours')}
                  placeholder="如：24小时"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {HOURS_PRESETS.slice(0, 3).map((hr) => (
                    <button
                      key={hr}
                      type="button"
                      onClick={() => setValue('openingHours', hr)}
                      className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded transition"
                    >
                      {hr}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 找路描述 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">
                  找路指引 / 密码说明（可选）
                </label>
                <span className="text-[11px] text-slate-400">
                  {watchedDescription.length}/200
                </span>
              </div>
              <textarea
                {...register('description')}
                placeholder="如：进门左转扶梯下B1、需要找收银台拿钥匙、门锁密码1234#"
                rows={2}
                maxLength={200}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 3. 拍照上传与可见性规则 */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-800">
                3. {isAdmin ? '实景照片（可选）与管理员免审公开' : '实景照片（决定公开或私有）'}
              </label>
              <span className="text-xs text-slate-400">最多 3 张</span>
            </div>

            {isAdmin && (
              <label className="flex items-start justify-between gap-3 rounded-xl p-3.5 bg-emerald-50 border border-emerald-300 cursor-pointer transition hover:bg-emerald-100/70">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <div className="font-extrabold text-emerald-900">
                      🛡️ 管理员特权：本人已亲自核验，跳过审核直接全网公开
                    </div>
                    <p className="text-emerald-700 mt-0.5">
                      开启后即使不拍照片也立即对所有用户公开，并打上「管理员实地核验」认证标识。
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={directPublish}
                  onChange={(e) => setDirectPublish(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-emerald-600 rounded shrink-0"
                />
              </label>
            )}

            <PhotoUploader photos={photos} onChange={setPhotos} maxCount={3} />

            {/* 动态可见性规则提示卡片 */}
            {!(isAdmin && directPublish) && (
              <div
                className={`rounded-xl p-3.5 text-xs leading-relaxed flex items-start gap-2.5 ${
                  hasPhotos
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : 'bg-purple-50 text-purple-800 border border-purple-200'
                }`}
              >
                {hasPhotos ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>已添加照片 → 自动审核通过后立即全网公开</strong>
                      <p className="text-blue-600/90 mt-0.5">
                        清晰合规的实景照片将由系统秒级自动审核通过并对所有人公开显示！
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>未上传照片 → 仅你自己可见（私人标记）</strong>
                      <p className="text-purple-600/90 mt-0.5">
                        他人无法看到此点位。以后路过时随时可在详情页补拍照片通过自动审核转为公开！
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3.5 rounded-xl font-bold text-sm text-white shadow-md transition disabled:opacity-50 ${
              isAdmin && directPublish
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : hasPhotos
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {submitting
              ? '正在保存...'
              : isAdmin && directPublish
                ? '🛡️ 管理员免审 · 立即全网公开'
                : hasPhotos
                  ? '📸 提交并通过自动审核公开'
                  : '🔒 保存为仅自己可见的私人标记'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AddToiletPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-400">加载中...</div>
      }
    >
      <AddToiletContent />
    </Suspense>
  );
}

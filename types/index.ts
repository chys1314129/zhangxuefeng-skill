export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export type ToiletSource = 'AMAP' | 'USER';

export type ToiletStatus = 'PUBLIC' | 'PRIVATE' | 'PENDING' | 'REJECTED';

export type MapEngineType = 'amap' | 'leaflet';

export interface MapBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt?: string;
}

export interface ToiletPhotoItem {
  id: string;
  toiletId: string;
  photoUrl: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ToiletItem {
  id: string;
  name: string;
  lng: number;
  lat: number;
  address: string | null;
  source: ToiletSource;
  status: ToiletStatus;
  amapId: string | null;
  isFree: boolean;
  hasPaper: boolean | null;
  hasAccessible: boolean | null;
  openingHours: string | null;
  floor: string | null;
  description: string | null;
  avgRating: number;
  commentCount: number;
  verifiedAt: string | null;
  rejectedReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  distance?: number;
  isOwn?: boolean;
  hasPhoto?: boolean;
  photos?: ToiletPhotoItem[];
  creator?: {
    id: string;
    username: string;
    nickname: string;
  };
}

export interface CommentItemData {
  id: string;
  toiletId?: string;
  toiletName?: string;
  content: string;
  rating: number | null;
  createdAt: string;
  timeAgo: string;
  user: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  };
}

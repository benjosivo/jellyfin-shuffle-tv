// Sous-ensemble des DTO Jellyfin utilisés par l'application.

export const TICKS_PER_SECOND = 10_000_000;

export interface JfPlayState {
  PositionTicks?: number;
  CanSeek?: boolean;
  IsPaused?: boolean;
  IsMuted?: boolean;
  VolumeLevel?: number;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MediaSourceId?: string;
  PlayMethod?: string;
  RepeatMode?: string;
}

export interface JfMediaStream {
  Type: string;
  Index: number;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  Codec?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
}

export interface JfItem {
  Id: string;
  Name?: string;
  Type?: string;
  SeriesId?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  RunTimeTicks?: number;
  ProductionYear?: number;
  MediaStreams?: JfMediaStream[];
  UserData?: { Played?: boolean };
}

/** Segment de média (API Media Segments, Jellyfin ≥ 10.10) : ex. « Outro » = générique de fin. */
export interface JfMediaSegment {
  Type?: string;
  StartTicks?: number;
  EndTicks?: number;
}

export interface JfMediaSegmentsResult {
  Items?: JfMediaSegment[];
}

export interface JfSession {
  Id: string;
  UserId?: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  DeviceId?: string;
  ApplicationVersion?: string;
  SupportsRemoteControl?: boolean;
  SupportsMediaControl?: boolean;
  LastActivityDate?: string;
  NowPlayingItem?: JfItem;
  PlayState?: JfPlayState;
  Capabilities?: {
    SupportedCommands?: string[];
    PlayableMediaTypes?: string[];
    SupportsMediaControl?: boolean;
  };
  /** Présent sur les anciennes versions de Jellyfin. */
  SupportedCommands?: string[];
}

export interface JfItemsResult {
  Items: JfItem[];
  TotalRecordCount?: number;
}

export type PlaystateCommand = "Stop" | "Pause" | "Unpause" | "PlayPause" | "Seek" | "NextTrack" | "PreviousTrack";

export function supportedCommands(session: JfSession): string[] {
  return session.Capabilities?.SupportedCommands ?? session.SupportedCommands ?? [];
}

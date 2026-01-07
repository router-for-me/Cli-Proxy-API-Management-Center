/**
 * 备份相关类型定义
 */

export interface BackupContent {
  env: boolean;
  config: boolean;
  auths: boolean;
}

export interface BackupMetadata {
  name: string;
  date: string;
  content: BackupContent;
  size: number;
}

export interface BackupListResponse {
  backups: BackupMetadata[];
  backupPath: string;
}

export interface BackupCreateRequest {
  name?: string;
  content: BackupContent;
  backupPath?: string;
}

export interface BackupCreateResponse {
  status: string;
  backup: BackupMetadata;
  filepath: string;
}

export interface BackupRestoreRequest {
  name: string;
  authsMode: 'overwrite' | 'incremental';
}

export interface BackupRestoreResponse {
  status: string;
  message: string;
}

import type { IconName } from '../theme/icons';

// The icon of a file by its extension, in any case (design system FileTransfer 文件列表); anything else is a plain file.
const TYPES: [IconName, string[]][] = [
  ['file-text', ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'ppt', 'pptx', 'key', 'pages']],
  ['file-sheet', ['xls', 'xlsx', 'csv', 'numbers']],
  ['file-image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg']],
  ['file-video', ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm']],
  ['file-audio', ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg']],
  ['file-archive', ['zip', 'rar', '7z', 'tar', 'gz']],
];

export function fileIcon(name: string): IconName {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'file';
  const ext = name.slice(dot + 1).toLowerCase();
  return TYPES.find(([, exts]) => exts.includes(ext))?.[0] ?? 'file';
}

// One icon for several files: their type when they all share it, else a plain file.
export function filesIcon(names: string[]): IconName {
  const icons = new Set(names.map(fileIcon));
  return icons.size === 1 ? [...icons][0] : 'file';
}

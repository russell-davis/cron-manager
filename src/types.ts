export interface JobMeta {
  name: string;
  description: string;
  tags: string[];
  scriptPath: string;
  originalPath: string;
  schedule: {
    raw: string;
    onCalendar?: string;
    onUnitActiveSec?: string;
    onBootSec?: string;
  };
  createdAt: string;
}

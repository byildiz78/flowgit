import { Mail, Paperclip, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface Stats {
  total_emails: string;
  total_attachments: string;
  last_processed: string;
}

interface EmailStatsProps {
  stats: Stats | null;
}

export function EmailStats({ stats }: EmailStatsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-blue-500/10 p-3 rounded-lg">
            <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Emails</p>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats?.total_emails || '0'}</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-purple-500/10 p-3 rounded-lg">
            <Paperclip className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Total Attachments</p>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{stats?.total_attachments || '0'}</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-emerald-500/10 p-3 rounded-lg">
            <Clock className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Last Processed</p>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
              {stats?.last_processed ? format(new Date(stats.last_processed), 'HH:mm') : 'Never'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
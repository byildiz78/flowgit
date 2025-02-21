"use client";

import { useEffect, useState, useRef } from 'react';
import { Search, RefreshCw, AlertTriangle, Mail, Inbox, Clock } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  EmailStats,
  EmailControls,
  EmailTable,
  EmailPagination,
  EmailDetailsDialog
} from './components/email-manager';

interface Email {
  id: number;
  subject: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  received_date: string;
  body_text: string;
  body_html: string | null;
  attachments: {
    id: number;
    filename: string;
    storage_path: string;
    public_url: string;
  }[];
  history: {
    id: number;
    status: string;
    message: string;
    created_at: string;
  }[];
}

interface Stats {
  total_emails: string;
  total_attachments: string;
  last_processed: string;
}

interface ApiResponse {
  error?: string;
  emails?: Email[];
  stats?: Stats;
  total?: number;
}

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingDb, setTestingDb] = useState(false);
  const [testingImap, setTestingImap] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortConfig, setSortConfig] = useState({ key: 'received_date', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [totalEmails, setTotalEmails] = useState(0);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const { toast } = useToast();
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneRef = useRef(false);

  const fetchEmails = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        sortKey: sortConfig.key,
        sortDir: sortConfig.direction,
        search: searchTerm
      });
      
      const res = await fetch(`/api/emails?${queryParams}`);
      const data: ApiResponse = await res.json();
      
      if (data.error) {
        setError(data.error);
        setEmails([]);
        setStats(null);
      } else {
        setError(null);
        setEmails(data.emails || []);
        setStats(data.stats || null);
        setTotalEmails(data.total || 0);
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
      setError('Failed to fetch emails');
      setEmails([]);
      setStats(null);
      toast({
        title: "Error",
        description: "Failed to fetch emails",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const testDbConnection = async () => {
    setTestingDb(true);
    try {
      const response = await fetch('/api/test-db');
      const data = await response.json();
      
      if (response.ok) {
        toast({
          title: "Database Connection Successful",
          description: `Connected successfully. Server time: ${new Date(data.timestamp?.now).toLocaleString()}`,
          variant: "default",
        });
      } else {
        toast({
          title: "Database Connection Failed",
          description: data.message || "Could not connect to database",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Database test error:', error);
      toast({
        title: "Connection Error",
        description: "Failed to test database connection",
        variant: "destructive",
      });
    } finally {
      setTestingDb(false);
    }
  };

  const testImapConnection = async () => {
    setTestingImap(true);
    try {
      const response = await fetch('/api/test-imap');
      const data = await response.json();
      
      if (response.ok) {
        toast({
          title: "IMAP Connection Successful",
          description: `Connected to ${data.config.host}:${data.config.port} as ${data.config.user}`,
          variant: "default",
        });
      } else {
        toast({
          title: "IMAP Connection Failed",
          description: data.message || "Could not connect to IMAP server",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('IMAP test error:', error);
      toast({
        title: "Connection Error",
        description: "Failed to test IMAP connection",
        variant: "destructive",
      });
    } finally {
      setTestingImap(false);
    }
  };

  const handleProcessEmails = async () => {
    try {
      setProcessing(true);
      const res = await fetch('/api/process-emails', {
        method: 'POST',
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.details || data.error || 'Failed to process emails');
      }
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Emails processed successfully",
        });
        await fetchEmails();
      } else {
        throw new Error(data.details || data.error || 'Failed to process emails');
      }
    } catch (error) {
      console.error('Error processing emails:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to process emails',
      });
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    const startPeriodicProcessing = () => {
      processingTimeoutRef.current = setTimeout(async () => {
        if (!initialLoadDoneRef.current) {
          await handleProcessEmails();
          initialLoadDoneRef.current = true;
        }
        
        processingTimeoutRef.current = setInterval(handleProcessEmails, 90000);
      }, 5000);
    };

    fetchEmails().then(() => {
      startPeriodicProcessing();
    });

    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        clearInterval(processingTimeoutRef.current);
      }
      setAutoProcessing(false);
    };
  }, []);

  useEffect(() => {
    setAutoProcessing(processing);
  }, [processing]);

  useEffect(() => {
    fetchEmails();
  }, [page, pageSize, sortConfig, searchTerm]);

  const handleSort = (key: string) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto py-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-lg">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Email Manager
                </h1>
                <p className="text-sm text-muted-foreground">
                  Manage and process your emails efficiently
                </p>
              </div>
            </div>
            <EmailControls
              onProcessEmails={handleProcessEmails}
              processing={processing}
              autoProcessing={autoProcessing}
              onTestDb={testDbConnection}
              onTestImap={testImapConnection}
              testingDb={testingDb}
              testingImap={testingImap}
            />
          </div>

          <EmailStats stats={stats} />
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden border-none shadow-xl bg-white/80 backdrop-blur-sm dark:bg-gray-800/80">
          <CardHeader className="border-b bg-white dark:bg-gray-800">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Inbox className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Processed Emails</CardTitle>
                <CardDescription>Manage and track your email processing</CardDescription>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Last updated: {stats?.last_processed ? new Date(stats.last_processed).toLocaleTimeString() : 'Never'}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center items-center py-32">
                <div className="flex flex-col items-center gap-4">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading emails...</p>
                </div>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <Mail className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">No emails found</p>
                <p className="text-sm text-muted-foreground/80">Try adjusting your search or process new emails</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <EmailTable
                    emails={emails}
                    onSort={handleSort}
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onViewHistory={setSelectedEmail}
                    fetchEmails={fetchEmails}
                  />
                </div>
                <div className="border-t bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                  <EmailPagination
                    page={page}
                    pageSize={pageSize}
                    totalEmails={totalEmails}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <EmailDetailsDialog
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
      />
    </div>
  );
}
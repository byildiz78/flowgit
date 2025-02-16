"use client";

import { useEffect, useState } from 'react';
import { Search, RefreshCw, AlertTriangle } from 'lucide-react';
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
    handleProcessEmails();
    const intervalId = setInterval(() => {
      handleProcessEmails();
    }, 90000);

    return () => {
      clearInterval(intervalId);
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
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Email Manager</h1>
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

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Processed Emails</CardTitle>
          <CardDescription>List of all processed emails with their details</CardDescription>
          <div className="mt-4 space-y-4">
            <div className="flex items-center space-x-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search emails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin" />
            </div>
          ) : emails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No emails found
            </div>
          ) : (
            <>
              {!error && emails.length > 0 && (
                <EmailTable
                  emails={emails}
                  onSort={handleSort}
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onViewHistory={setSelectedEmail}
                  fetchEmails={fetchEmails}
                />
              )}
              <EmailPagination
                page={page}
                pageSize={pageSize}
                totalEmails={totalEmails}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </CardContent>
      </Card>

      <EmailDetailsDialog
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
      />
    </div>
  );
}
import { Paperclip, History, ArrowUpDown, ChevronUp, ChevronDown, ArrowRightCircle, Loader2, CheckCircle2, Mail, X, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState } from 'react';
import { useToast } from "../../../components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { encodeEmailId } from '@/lib/emailIdEncoder';

interface Email {
  id: number;
  subject: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  received_date: string;
  body_text: string;
  body_html: string;
  senttoflow: boolean;
  attachments: Array<{
    filename: string;
    public_url: string;
  }>;
  history: Array<{
    id: number;
    status: string;
    message: string;
    created_at: string;
    details: string;
  }>;
}

interface EmailTableProps {
  emails: Email[];
  onSort: (field: string) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onViewHistory: (email: Email) => void;
  fetchEmails: () => void;
}

export function EmailTable({ emails, onSort, sortField, sortDirection, onViewHistory, fetchEmails }: EmailTableProps) {
  const { toast } = useToast();

  console.log('EmailTable received emails:', emails);

  const getSortIcon = (key: string) => {
    if (sortField === key) {
      return sortDirection === 'asc' ? 
        <ChevronUp className="ml-2 h-4 w-4" /> : 
        <ChevronDown className="ml-2 h-4 w-4" />;
    }
    return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground/70" />;
  };

  const [sendingToFlow, setSendingToFlow] = useState<number | null>(null);
  const [sendingEmailToFlow, setSendingEmailToFlow] = useState<number | null>(null);

  const handleSendToFlow = async (email: Email) => {
    try {
      setSendingToFlow(email.id);
      const res = await fetch('/api/send-to-flow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send to Flow');
      }

      toast({
        title: "Success",
        description: `Successfully sent to Flow - ID: ${data.data.result.item.id}`,
      });

      // Refresh the email data to get updated history
      await fetchEmails();
    } catch (error) {
      console.error('Error sending to Flow:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to send to Flow',
      });
    } finally {
      setSendingToFlow(null);
    }
  };

  const handleSendEmailToFlow = async (email: Email) => {
    try {
      setSendingEmailToFlow(email.id);
      const res = await fetch('/api/send-email-to-flow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send email to Flow');
      }

      toast({
        title: "Success",
        description: (
          <div className="mt-2 space-y-2">
            <p>
              {data.data.flow ? 
                `Successfully sent email to Flow - ID: ${data.data.flow.result.item.id}` :
                `Successfully sent email to Flow with existing Flow ID`}
            </p>
            <div className="mt-2 p-2 bg-secondary/20 rounded-md">
              <p className="text-xs font-medium mb-1">Debug Information:</p>
              <pre className="text-[10px] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto">
                {JSON.stringify(data.data.debug, null, 2)}
              </pre>
            </div>
          </div>
        ),
        duration: 10000, // 10 saniye göster
      });

      // Refresh the email data to get updated history
      await fetchEmails();
    } catch (error) {
      console.error('Error sending email to Flow:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to send email to Flow',
      });
    } finally {
      setSendingEmailToFlow(null);
    }
  };

  const renderHistoryStatus = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Success
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            {status}
          </Badge>
        );
    }
  };

  const formatHistoryDetails = (details: string) => {
    try {
      const parsedDetails = JSON.parse(details);
      if (parsedDetails.flowId) {
        return (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Flow ID: {parsedDetails.flowId}
            </p>
            {parsedDetails.response?.result?.item && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Title: {parsedDetails.response.result.item.title}</p>
                <p>Stage: {parsedDetails.response.result.item.stageId}</p>
                <p>Contact ID: {parsedDetails.response.result.item.contactId}</p>
              </div>
            )}
          </div>
        );
      }
      if (parsedDetails.error) {
        return (
          <p className="text-sm text-red-600">
            Error: {parsedDetails.error}
          </p>
        );
      }
      return <p className="text-sm text-muted-foreground">{details}</p>;
    } catch {
      return <p className="text-sm text-muted-foreground">{details}</p>;
    }
  };

  const extractFlowId = (subject: string): string | null => {
    const match = subject.match(/#FlowID=(\d+)#/);
    return match ? match[1] : null;
  };

  const getFlowLink = (flowId: string): string => {
    return `https://crm.robotpos.com/page/call_center/call_center_spa/type/1036/details/${flowId}/`;
  };

  return (
    <div className="rounded-xl border-2 border-border/50 shadow-md bg-card overflow-hidden backdrop-blur-sm">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5 pointer-events-none" />
        <Table className="w-full border-collapse">
          <TableHeader>
            <TableRow className="bg-gradient-to-r from-muted/90 to-muted/70 hover:from-muted hover:to-muted transition-all duration-200">
              <TableHead className="w-[8%] border-r border-border/50 py-5 px-4">
                <Button
                  variant="ghost"
                  onClick={() => onSort('id')}
                  className="hover:bg-transparent -ml-4 font-semibold text-foreground"
                >
                  ID
                  {getSortIcon('id')}
                </Button>
              </TableHead>
              <TableHead className="w-[25%] border-r border-border/50 py-5 px-4">
                <Button
                  variant="ghost"
                  onClick={() => onSort('subject')}
                  className="hover:bg-transparent -ml-4 font-semibold text-foreground"
                >
                  Subject
                  {getSortIcon('subject')}
                </Button>
              </TableHead>
              <TableHead className="w-[5%] border-r border-border/50 py-5 px-4 font-semibold text-foreground">
                Flow Linki
              </TableHead>
              <TableHead className="w-[20%] border-r border-border/50 py-5 px-4">
                <Button
                  variant="ghost"
                  onClick={() => onSort('from_address')}
                  className="hover:bg-transparent -ml-4 font-semibold text-foreground whitespace-nowrap"
                >
                  From
                  {getSortIcon('from_address')}
                </Button>
              </TableHead>
              <TableHead className="w-[20%] font-semibold text-foreground border-r border-border/50 py-5 px-4">Recipients</TableHead>
              <TableHead className="w-[12%] border-r border-border/50 py-5 px-4">
                <Button
                  variant="ghost"
                  onClick={() => onSort('received_date')}
                  className="hover:bg-transparent -ml-4 font-semibold text-foreground whitespace-nowrap"
                >
                  Date
                  {getSortIcon('received_date')}
                </Button>
              </TableHead>
              <TableHead className="w-[8%] font-semibold text-foreground border-r border-border/50 py-5 px-4">Attachments</TableHead>
              <TableHead className="w-[5%] font-semibold text-foreground text-right py-5 px-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.map((email, index) => (
              <TableRow 
                key={email.id} 
                className={cn(
                  "hover:bg-muted/50 transition-colors relative",
                  email.senttoflow && "bg-gradient-to-r from-green-50 to-blue-50 hover:from-green-100 hover:to-blue-100"
                )}
              >
                <TableCell className="w-[8%] border-r border-border/50 py-4 px-4">
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "font-normal transition-all duration-200",
                      "group-hover:bg-primary/10 group-hover:border-primary/30",
                      "hover:scale-105",
                      email.senttoflow && "border-green-200 bg-green-50/50"
                    )}
                  >
                    #{email.id}
                  </Badge>
                </TableCell>
                <TableCell className="py-4 px-4">
                  <div className="flex items-center gap-2">
                    {email.senttoflow && (
                      <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                    )}
                    <div>
                      <p className={cn(
                        "text-sm font-medium leading-none mb-1",
                        email.senttoflow && "text-blue-700"
                      )}>
                        {email.subject}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-[5%] border-r border-border/50 py-4 px-4 text-center">
                  {extractFlowId(email.subject) ? (
                    <a 
                      href={getFlowLink(extractFlowId(email.subject)!)} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center text-primary hover:text-primary/80 transition-colors"
                    >
                      <span className="mr-1">Flow Linki</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="w-[20%] border-r border-border/50 py-4 px-4">
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "font-normal",
                      email.senttoflow && "border-green-200 bg-green-50/50"
                    )}
                  >
                    {email.from_address}
                  </Badge>
                </TableCell>
                <TableCell className="w-[20%] border-r border-border/50 py-4">
                  <div className="space-y-1">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground mb-1">To:</span>
                      {email.to_addresses.map((address, i) => (
                        <Badge 
                          key={i} 
                          variant="secondary" 
                          className={cn(
                            "mb-1 text-xs font-normal transition-all duration-200",
                            "group-hover:bg-primary/10 group-hover:text-primary",
                            "hover:scale-105"
                          )}
                        >
                          {address}
                        </Badge>
                      ))}
                    </div>
                    {email.cc_addresses?.length > 0 && (
                      <div className="flex flex-col mt-2">
                        <span className="text-xs font-medium text-muted-foreground mb-1">CC:</span>
                        {email.cc_addresses.map((address, i) => (
                          <Badge 
                            key={i} 
                            variant="secondary" 
                            className={cn(
                              "mb-1 text-xs font-normal transition-all duration-200",
                              "group-hover:bg-primary/10 group-hover:text-primary",
                              "hover:scale-105"
                            )}
                          >
                            {address}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="w-[12%] border-r border-border/50 py-4">
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "font-normal transition-all duration-200",
                      "group-hover:bg-primary/10 group-hover:border-primary/30",
                      "hover:scale-105"
                    )}
                  >
                    {format(new Date(email.received_date), 'MMM d, yyyy HH:mm')}
                  </Badge>
                </TableCell>
                <TableCell className="w-[8%] border-r border-border/50 py-4">
                  {email.attachments.length > 0 ? (
                    <div className="space-y-1">
                      {email.attachments.map((attachment) => (
                        <div key={attachment.filename} className="flex items-center space-x-2">
                          <a
                            href={attachment.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "inline-flex items-center space-x-1 text-sm",
                              "text-primary/80 hover:text-primary transition-colors",
                              "group-hover:text-primary hover:scale-105",
                              "relative after:absolute after:bottom-0 after:left-0",
                              "after:h-[1px] after:w-0 hover:after:w-full",
                              "after:bg-primary after:transition-all after:duration-300"
                            )}
                          >
                            <Paperclip className="h-4 w-4 group-hover:scale-110 transition-transform duration-200" />
                            <span className="truncate max-w-[150px]">{attachment.filename}</span>
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="w-[5%] text-right py-4">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const encodedId = encodeEmailId(email.id);
                        window.open(`/email/${encodedId}`, '_blank');
                      }}
                    >
                      <History className="h-4 w-4 mr-1" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendToFlow(email)}
                      disabled={sendingToFlow === email.id}
                      className="hidden"
                    >
                      {sendingToFlow === email.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRightCircle className="h-4 w-4 mr-1" />
                      )}
                      Send to Flow
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendEmailToFlow(email)}
                      disabled={sendingEmailToFlow === email.id}
                      className="hidden"
                    >
                      {sendingEmailToFlow === email.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4 mr-1" />
                      )}
                      Send Email to Flow
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

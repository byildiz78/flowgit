import { Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Email } from '@/app/types/email';

interface EmailDetailsDialogProps {
  email: Email | null;
  onClose: () => void;
}

export function EmailDetailsDialog({ email, onClose }: EmailDetailsDialogProps) {
  if (!email) return null;

  return (
    <Dialog open={!!email} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{email.subject}</DialogTitle>
          <DialogDescription>
            Email details and processing history
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Email Details */}
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 items-start">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">From</h4>
                <p>{email.from_address}</p>
              </div>
              <div className="space-y-1 col-span-2">
                <h4 className="text-sm font-medium text-muted-foreground">Date</h4>
                <p>{format(new Date(email.received_date), 'MMM d, yyyy HH:mm:ss')}</p>
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">To</h4>
              {email.to_addresses.map((address, i) => (
                <p key={i} className="text-sm">{address}</p>
              ))}
            </div>

            {email.cc_addresses?.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">CC</h4>
                {email.cc_addresses.map((address, i) => (
                  <p key={i} className="text-sm">{address}</p>
                ))}
              </div>
            )}

            {/* Attachments */}
            {email.attachments.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Attachments</h4>
                <div className="flex flex-wrap gap-2">
                  {email.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={`/api/attachments/${attachment.id}/${encodeURIComponent(attachment.filename)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
                    >
                      <Paperclip className="h-4 w-4" />
                      <span className="text-sm">{attachment.filename}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Email Body */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Message</h4>
              <div className="rounded-md border bg-muted/50 p-4">
                {email.body_html ? (
                  <div 
                    className="prose prose-sm max-w-none dark:prose-invert" 
                    dangerouslySetInnerHTML={{ __html: email.body_html }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">{email.body_text}</pre>
                )}
              </div>
            </div>
          </div>

          {/* Processing History */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground border-t pt-4">Processing History</h4>
            <div className="space-y-4">
              {email.history.map((entry) => (
                <div key={entry.id} className="flex flex-col space-y-1 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <Badge variant={entry.status === 'success' ? 'default' : 'destructive'}>
                      {entry.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(entry.created_at), 'MMM d, yyyy HH:mm:ss')}
                    </span>
                  </div>
                  <p className="text-sm mt-2">{entry.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

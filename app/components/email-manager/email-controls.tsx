import { RefreshCw, Database, Mail } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EmailControlsProps {
  onProcessEmails: () => Promise<void>;
  processing: boolean;
  autoProcessing: boolean;
  onTestDb: () => Promise<void>;
  onTestImap: () => Promise<void>;
  testingDb: boolean;
  testingImap: boolean;
}

export function EmailControls({
  onProcessEmails,
  processing,
  autoProcessing,
  onTestDb,
  onTestImap,
  testingDb,
  testingImap,
}: EmailControlsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={onTestDb}
        disabled={testingDb}
        variant="outline"
        className="relative group overflow-hidden"
      >
        <div className="flex items-center gap-2">
          <Database className={cn(
            "h-4 w-4 transition-transform",
            testingDb && "animate-spin"
          )} />
          <span>{testingDb ? "Testing DB" : "Test DB"}</span>
        </div>
        <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform" />
      </Button>
      
      <Button
        onClick={onTestImap}
        disabled={testingImap}
        variant="outline"
        className="relative group overflow-hidden"
      >
        <div className="flex items-center gap-2">
          <Mail className={cn(
            "h-4 w-4 transition-transform",
            testingImap && "animate-spin"
          )} />
          <span>{testingImap ? "Testing IMAP" : "Test IMAP"}</span>
        </div>
        <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform" />
      </Button>
      
      <Button
        onClick={onProcessEmails}
        disabled={processing}
        className="relative group overflow-hidden bg-gradient-to-r from-primary to-primary/80"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className={cn(
            "h-4 w-4 transition-transform",
            processing && "animate-spin"
          )} />
          <span>
            {processing ? (
              autoProcessing ? "Auto Processing..." : "Processing..."
            ) : (
              "Process Emails"
            )}
          </span>
        </div>
        <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform" />
      </Button>
    </div>
  );
}
import { RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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
    <div className="space-x-4">
      <Button
        onClick={onTestDb}
        disabled={testingDb}
        variant="outline"
      >
        {testingDb ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Testing DB
          </>
        ) : (
          "Test DB Connection"
        )}
      </Button>
      <Button
        onClick={onTestImap}
        disabled={testingImap}
        variant="outline"
      >
        {testingImap ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Testing IMAP
          </>
        ) : (
          "Test IMAP Connection"
        )}
      </Button>
      <Button
        onClick={onProcessEmails}
        disabled={processing}
      >
        {processing ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {autoProcessing ? "Auto Processing..." : "Processing..."}
          </>
        ) : (
          <>
            <RefreshCw className="mr-2 h-4 w-4" />
            Process New Emails
          </>
        )}
      </Button>
    </div>
  );
}

export interface Email {
  id: number;
  subject: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  received_date: string;
  body_text: string;
  body_html: string | null;
  attachments: Array<{
    id: number;
    filename: string;
    storage_path: string;
    public_url: string;
  }>;
  history: Array<{
    id: number;
    status: string;
    message: string;
    created_at: string;
    details?: string;
  }>;
}

"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { decodeEmailId } from '@/lib/emailIdEncoder';

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

export default function EmailPage({ params }: { params: { id: string } }) {
  const [email, setEmail] = useState<Email | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEmail = async () => {
      try {
        const decodedId = decodeEmailId(params.id);
        const res = await fetch(`/api/emails/${decodedId}`);
        if (!res.ok) {
          throw new Error('Email not found');
        }
        const data = await res.json();
        setEmail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch email');
      }
    };

    fetchEmail();
  }, [params.id]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!email) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-4">{email.subject}</h1>
        
        <div className="mb-4">
          <p className="text-gray-600"><strong>From:</strong> {email.from_address}</p>
          <p className="text-gray-600"><strong>To:</strong> {email.to_addresses.join(', ')}</p>
          {email.cc_addresses.length > 0 && (
            <p className="text-gray-600"><strong>CC:</strong> {email.cc_addresses.join(', ')}</p>
          )}
          <p className="text-gray-600"><strong>Date:</strong> {new Date(email.received_date).toLocaleString()}</p>
        </div>

        {email.attachments.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Attachments</h2>
            <ul className="list-disc list-inside">
              {email.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a href={attachment.public_url} className="text-blue-600 hover:underline">
                    {attachment.filename}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Content</h2>
          {email.body_html ? (
            <div dangerouslySetInnerHTML={{ __html: email.body_html }} className="prose max-w-none" />
          ) : (
            <pre className="whitespace-pre-wrap">{email.body_text}</pre>
          )}
        </div>

        {email.history && email.history.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-2">History</h2>
            <div className="space-y-2">
              {email.history.map((item) => (
                <div key={item.id} className="p-3 bg-gray-50 rounded">
                  <p className="font-medium">{item.status}</p>
                  <p className="text-gray-600">{item.message}</p>
                  <p className="text-sm text-gray-500">{new Date(item.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

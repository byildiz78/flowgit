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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Email Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
            <h1 className="text-2xl font-bold mb-4">{email.subject}</h1>
            <div className="space-y-2 text-blue-50">
              <p><span className="inline-block w-16 opacity-75">From:</span> {email.from_address}</p>
              <p><span className="inline-block w-16 opacity-75">To:</span> {email.to_addresses.join(', ')}</p>
              {email.cc_addresses.length > 0 && (
                <p><span className="inline-block w-16 opacity-75">CC:</span> {email.cc_addresses.join(', ')}</p>
              )}
              <p><span className="inline-block w-16 opacity-75">Date:</span> {new Date(email.received_date).toLocaleString('tr-TR')}</p>
            </div>
          </div>

          <div className="p-6">
            {/* Attachments Section */}
            {email.attachments.length > 0 && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Attachments
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {email.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={`/attachments/${attachment.storage_path}`}
                      className="flex items-center p-3 bg-white rounded border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all group"
                    >
                      <svg className="w-6 h-6 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="ml-2 text-gray-600 group-hover:text-blue-600">{attachment.filename}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Email Content */}
            <div className="mt-6">
              {email.body_html ? (
                <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
              ) : (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <pre className="whitespace-pre-wrap text-gray-700 font-sans">{email.body_text}</pre>
                </div>
              )}
            </div>

            {/* Email History */}
            {email.history && email.history.length > 0 && (
              <div className="mt-8 border-t pt-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Email History
                </h2>
                <div className="space-y-3">
                  {email.history.map((item) => (
                    <div key={item.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-700">{item.status}</span>
                        <span className="text-sm text-gray-500">{new Date(item.created_at).toLocaleString('tr-TR')}</span>
                      </div>
                      <p className="text-gray-600">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

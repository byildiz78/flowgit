# Email Processing System

A robust email processing system built with Next.js that automatically fetches, processes, and stores emails with attachments from an IMAP server into a PostgreSQL database.

## Features

- 📧 Automatic email fetching from IMAP server
- 📎 Attachment handling and storage
- 🗃️ PostgreSQL database integration
- 📊 Beautiful dashboard interface
- 🔄 Real-time email processing
- 📝 Email history tracking
- 🔒 Secure credential management

## Tech Stack

- **Frontend**: Next.js 13.5 with App Router
- **UI Components**: shadcn/ui + Tailwind CSS
- **Database**: PostgreSQL
- **Email Processing**: node-imap + mailparser
- **Icons**: Lucide React

## Environment Variables

```env
# Email Configuration
EMAIL=your-email@domain.com
EMAIL_PASSWORD=your-password
IMAP_HOST=imap.domain.com
IMAP_PORT=993

# PostgreSQL Configuration
POSTGRES_USER=admin
POSTGRES_PASSWORD=your-password
POSTGRES_HOST=your-host
POSTGRES_PORT=5432
POSTGRES_DB=emailforwarder
POSTGRES_SSL=false
```

## Database Schema

### Emails Table
```sql
CREATE TABLE emails (
    id SERIAL PRIMARY KEY,
    message_id TEXT UNIQUE,
    from_address TEXT NOT NULL,
    to_addresses TEXT[] NOT NULL,
    cc_addresses TEXT[],
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    received_date TIMESTAMP WITH TIME ZONE NOT NULL,
    processed_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    imap_uid INTEGER,
    flagged BOOLEAN DEFAULT FALSE
);

-- Indexes
CREATE INDEX idx_emails_message_id ON emails(message_id);
CREATE INDEX idx_emails_received_date ON emails(received_date);
CREATE INDEX idx_emails_flagged ON emails(flagged);
```

### Attachments Table
```sql
CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT,
    size INTEGER,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_attachments_email_id ON attachments(email_id);
```

### Email History Table
```sql
CREATE TABLE email_history (
    id SERIAL PRIMARY KEY,
    email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_email_history_email_id ON email_history(email_id);
```

## API Endpoints

### GET /api/emails
Retrieves all processed emails with their attachments.

### POST /api/process-emails
Triggers the email processing job to fetch and store new emails.

## Setup Instructions

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with the required environment variables
4. Initialize the database:
   ```bash
   npm run init-db
   ```
5. Start the development server:
   ```bash
   npm run dev
   ```

## Email Processing Flow

1. System connects to the IMAP server using provided credentials
2. Searches for unprocessed emails (UNFLAGGED)
3. For each email:
   - Parses email content and metadata
   - Stores email data in the database
   - Saves attachments to the filesystem
   - Records processing history
   - Marks email as processed (FLAGGED)

## Dashboard Features

- Real-time email processing status
- Email list with detailed view
- Attachment preview and management
- Processing history and status tracking
- Statistics and metrics display

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── emails/
│   │   └── process-emails/
│   ├── page.tsx
│   └── layout.tsx
├── components/
│   └── ui/
├── lib/
│   ├── db.ts
│   ├── imap.ts
│   └── utils.ts
├── public/
└── scripts/
    └── init-db.ts
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
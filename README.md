# Prometheus NPS

A modern Net Promoter Score (NPS) feedback system with email integration, vector database storage, and AI-powered feedback analysis.

## Features

- 🎯 **NPS Feedback Collection**: Easy-to-use form for collecting customer feedback and NPS scores
- 📊 **Real-time Analytics**: Live NPS score calculation and AI-generated feedback summaries
- 📧 **Email Integration**: Automated email notifications and personalized feedback form links
- 🔒 **Secure Authentication**: JWT-based authentication for form access
- 🤖 **AI-Powered Analysis**: OpenAI integration for feedback summarization and analysis
- 📦 **Vector Database**: Supabase integration for efficient feedback storage and retrieval
- 📈 **Data Export**: Export feedback data to CSV for further analysis
- 🛡️ **Security Features**: Rate limiting, input validation, and API key protection

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Alpine.js + Tailwind CSS
- **Database**: Supabase (PostgreSQL + Vector extensions)
- **AI**: OpenAI API (GPT-3.5 + text-embedding-3-small)
- **Email**: Resend (Production) / Mailpit (Development)
- **Security**: Helmet, Express Validator, Rate Limiting

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Supabase account
- OpenAI API key
- Resend API key (for production)
- Mailpit (for local development)

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Zeb88/prometheus-nps.git
   cd prometheus-nps
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=3002
   NODE_ENV=development
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   RESEND_API_KEY=your_resend_api_key
   JWT_SECRET=your_jwt_secret
   ADMIN_API_KEY=your_admin_api_key
   ```

4. **Database Setup**
   Run the following SQL in your Supabase database:
   ```sql
   -- Enable the moddatetime extension
   CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

   -- Create the feedback table with timestamp management
   CREATE TABLE feedback (
     id uuid default uuid_generate_v4() primary key,
     inserted_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
     updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
     name text NOT NULL,
     email text NOT NULL,
     nps_score smallint NOT NULL,
     feedback text NOT NULL,
     embedding vector(768)
   );

   -- Create trigger for automatic updated_at timestamp
   CREATE TRIGGER handle_updated_at
     BEFORE UPDATE ON feedback
     FOR EACH ROW
     EXECUTE PROCEDURE moddatetime(updated_at);
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## Usage

### Collecting Feedback

1. **Generate Form Link**
   - Access the admin interface
   - Enter customer name and email
   - Generate and send personalized feedback form link

2. **Submit Feedback**
   - Customer receives email with unique form link
   - Fills out NPS score (0-10) and feedback
   - Submission stored in database with vector embedding

### Analyzing Results

1. **View Summary**
   - Access `/summary` endpoint
   - View current NPS score
   - Read AI-generated feedback summary
   - Download complete feedback data as CSV

### API Endpoints

- `POST /api/feedback` - Submit feedback
- `GET /api/summary` - Get NPS summary and AI analysis
- `POST /api/generate-form-link` - Generate personalized form link
- `POST /api/verify-token` - Verify form access token
- `GET /api/download-csv` - Download feedback data as CSV

## Security

- API endpoints protected with API key authentication
- Rate limiting on form submissions and API requests
- Input validation and sanitization
- Secure headers with Helmet
- JWT-based form access

## Development

For local development:
1. Install Mailpit for email testing
2. Set `NODE_ENV=development`
3. Run `npm run dev`
4. Access Mailpit interface at `http://localhost:8025`

## Production

For production deployment:
1. Set `NODE_ENV=production`
2. Configure Resend API key
3. Set secure JWT and Admin API keys
4. Run `npm start`

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

### API Documentation

The API documentation is available through Swagger UI at `/api-docs`. This interactive documentation includes:

- Detailed endpoint descriptions
- Request/response schemas
- Authentication requirements
- Try-it-out functionality

Access the documentation at `http://localhost:3002/api-docs` when running locally.

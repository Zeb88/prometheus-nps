// Dependencies
const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require('openai');
const { Resend } = require("resend");
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
require("dotenv").config();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const { Parser } = require('json2csv');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const nunjucks = require('nunjucks');

const app = express();
const port = 3002;

// Configure Supabase, OpenAI, and Resend
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Create email transport based on environment
const isDevelopment = process.env.NODE_ENV !== 'production';
let emailService;

if (isDevelopment) {
    // Configure Nodemailer with Mailpit for development
    const mailpitTransport = nodemailer.createTransport({
        host: process.env.MAILPIT_HOST || "mailpit",  // Use service name from docker-compose
        port: 1025,
        secure: false,
        ignoreTLS: true
    });

    emailService = {
        async sendEmail({ to, from, subject, html }) {
            try {
                const info = await mailpitTransport.sendMail({
                    to,
                    from: from || 'test@example.com',
                    subject,
                    html
                });
                
                console.log('Email sent to Mailpit');
                console.log('Preview URL: http://localhost:8025');  // Mailpit web interface
                
                return info;
            } catch (error) {
                console.error('Error sending email to Mailpit:', error);
                throw error;
            }
        }
    };
} else {
    emailService = new Resend(process.env.RESEND_API_KEY);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://cdn.jsdelivr.net",
                "https://cdn.tailwindcss.com"
            ],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'"],
            childSrc: ["'self'"],
            workerSrc: ["'self'"],
            frameAncestors: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5 // stricter limit for form generation
});

// Apply rate limiting
app.use(limiter);

// API Key middleware for admin endpoints
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Input validation middleware
const validateFeedback = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('npsScore').isInt({ min: 0, max: 10 }),
    body('feedback').trim().isLength({ min: 1, max: 280 }).escape()
];

const validateFormLink = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail()
];

// Configure nunjucks after your other middleware
nunjucks.configure('templates', {
    autoescape: true,
    express: app,
    watch: isDevelopment
});

// Serve the HTML template
app.get("/", (req, res) => {
    res.render('index.html', {
        title: 'Home'
    });
});

app.get("/form", (req, res) => {
    res.render('form.html', {
        title: 'Feedback Form'
    });
});

// API: Submit Feedback
app.post("/api/feedback", validateFeedback, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, npsScore, feedback } = req.body;

    try {
        // Create OpenAI embedding using text-embedding-3-small model
        const embeddingResponse = await openai.embeddings.create({
            input: feedback,
            model: "text-embedding-3-small",  // This model produces 1536 dimensions
            dimensions: 768  // Explicitly request 768 dimensions
        });
        const embedding = embeddingResponse.data[0].embedding;

        // Insert feedback into Supabase
        const { data, error } = await supabase
            .from("feedback")
            .insert({ name, email, nps_score: npsScore, feedback, embedding });

        if (error) throw error;

        await emailService.sendEmail({
            to: email,
            from: isDevelopment ? "test@example.com" : "no-reply@yourdomain.com",
            subject: "Thank you for your feedback!",
            html: `<p>Hi ${name},</p><p>Thank you for sharing your feedback!</p>`,
        });

        res.status(200).json({ message: "Feedback submitted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to submit feedback." });
    }
});

// API: Summarize Feedback
app.get("/api/summary", validateApiKey, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("feedback")
            .select("nps_score, feedback"); // Select both nps_score and feedback fields

        if (error) throw error;

        const totalResponses = data.length;

        if (totalResponses === 0) {
            return res.status(200).json({ nps: 0, message: "No feedback available." });
        }

        const promoters = data.filter(entry => entry.nps_score >= 9).length;
        const detractors = data.filter(entry => entry.nps_score <= 6).length;

        // Calculate percentages
        const promotersPercentage = (promoters / totalResponses) * 100;
        const detractorsPercentage = (detractors / totalResponses) * 100;

        // Calculate NPS
        const nps = promotersPercentage - detractorsPercentage;

        const feedbackTexts = data.map(entry => entry.feedback).join("\n");

        const completion = await openai.completions.create({
            model: "gpt-3.5-turbo-instruct",
            prompt: `Summarize the following feedback:\n${feedbackTexts}`,
            max_tokens: 150,
        });

        res.status(200).json({ 
            summary: completion.choices[0].text.trim(),
            nps: nps.toFixed(2) // Return NPS rounded to two decimal places
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to summarize feedback." });
    }
});


// Add this new endpoint
app.post("/api/generate-form-link", strictLimiter, validateFormLink, validateApiKey, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, name } = req.body;
    
    try {
        const token = jwt.sign(
            { email, name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        const formUrl = `${req.protocol}://${req.get('host')}/form?token=${token}`;
        
        await emailService.sendEmail({
            to: email,
            from: isDevelopment ? "test@example.com" : "no-reply@yourdomain.com",
            subject: "Your Feedback Form Link",
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Hello ${name},</h2>
                    <p>We value your feedback! Please click the link below to share your thoughts with us:</p>
                    <p style="margin: 20px 0;">
                        <a href="${formUrl}" 
                           style="background-color: #D55672; 
                                  color: white; 
                                  padding: 12px 24px; 
                                  text-decoration: none; 
                                  border-radius: 6px; 
                                  display: inline-block;">
                            Share Your Feedback
                        </a>
                    </p>
                    <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
                    <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this URL into your browser:</p>
                    <p style="color: #666; font-size: 14px; word-break: break-all;">${formUrl}</p>
                </div>
            `
        });
        
        res.json({ 
            message: "Form link generated and sent to email",
            url: formUrl
        });
    } catch (error) {
        console.error('Error generating form link:', error);
        res.status(500).json({ error: "Failed to generate form link" });
    }
});

// Add this endpoint to verify tokens
app.post("/api/verify-token", async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({
            name: decoded.name,
            email: decoded.email
        });
    } catch (error) {
        res.status(401).json({ error: "Invalid or expired token" });
    }
});

// Add this new route after your existing routes
app.get("/docs", (req, res) => {
    res.render('docs.html', {
        title: 'Documentation'
    });
});

app.get("/summary", (req, res) => {
    res.render('summary.html', {
        title: 'Summary'
    });
});

// Add this new endpoint after your existing routes
app.get("/api/download-csv", validateApiKey, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("feedback")
            .select("inserted_at, name, email, nps_score, feedback")
            .order('inserted_at', { ascending: false });

        if (error) throw error;

        const fields = [
            { label: 'Date', value: 'inserted_at' },
            { label: 'Name', value: 'name' },
            { label: 'Email', value: 'email' },
            { label: 'NPS Score', value: 'nps_score' },
            { label: 'Feedback', value: 'feedback' }
        ];
        
        const opts = { fields };
        const parser = new Parser(opts);
        const csv = parser.parse(data);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=feedback-responses.csv');
        res.status(200).send(csv);
    } catch (error) {
        console.error('Error generating CSV:', error);
        res.status(500).json({ error: "Failed to generate CSV file" });
    }
});

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Prometheus NPS API',
            version: '1.0.0',
            description: 'API documentation for Prometheus NPS feedback system',
        },
        servers: [
            {
                url: process.env.NODE_ENV === 'production' 
                    ? 'https://your-production-url.com' 
                    : `http://localhost:${port}`,
                description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key',
                    description: 'Admin API key for protected endpoints'
                },
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token for form access'
                }
            }
        }
    },
    apis: ['./server.js'], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Add Swagger documentation for each endpoint
/**
 * @swagger
 * /api/feedback:
 *   post:
 *     summary: Submit NPS feedback
 *     tags: [Feedback]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - npsScore
 *               - feedback
 *             properties:
 *               name:
 *                 type: string
 *                 description: Customer name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Customer email
 *               npsScore:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 10
 *                 description: NPS score (0-10)
 *               feedback:
 *                 type: string
 *                 description: Customer feedback text
 *     responses:
 *       200:
 *         description: Feedback submitted successfully
 *       400:
 *         description: Invalid input data
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/summary:
 *   get:
 *     summary: Get NPS summary and AI analysis
 *     tags: [Analysis]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Summary data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nps:
 *                   type: string
 *                   description: Current NPS score
 *                 summary:
 *                   type: string
 *                   description: AI-generated feedback summary
 *       401:
 *         description: Unauthorized - Invalid API key
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/generate-form-link:
 *   post:
 *     summary: Generate personalized feedback form link
 *     tags: [Form Management]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *                 description: Customer name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Customer email
 *     responses:
 *       200:
 *         description: Form link generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 url:
 *                   type: string
 *       401:
 *         description: Unauthorized - Invalid API key
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/verify-token:
 *   post:
 *     summary: Verify form access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: JWT token to verify
 *     responses:
 *       200:
 *         description: Token verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *       401:
 *         description: Invalid or expired token
 */

/**
 * @swagger
 * /api/download-csv:
 *   get:
 *     summary: Download feedback data as CSV
 *     tags: [Data Export]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized - Invalid API key
 *       500:
 *         description: Server error
 */

// Start the Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

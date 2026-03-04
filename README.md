# 🚀 Domain & Hosting SaaS Chatbot (Generative UI)

A powerful, multi-tenant RAG chatbot designed specifically for Domain, Hosting, and VPS providers. Built with the **Vercel AI SDK**, **FastAPI**, and **Qdrant**, this chatbot goes beyond pure text by rendering interactive Next.js React components directly inside the conversational flow using Generative UI.

## ✨ Features

- **🏢 Multi-Tenant Built-in:** Each SaaS customer gets their own customizable API key, Chat Widget, and an isolated Knowledge Base (Qdrant collection).
- **🧠 Advanced RAG Engine:** Ground the AI's answers to your specific product lines, company policies, and pricing tables via `sentence-transformers` and Qdrant.
- **⚡ Generative UI Components:** The AI acts as an autonomous sales and support agent by dynamically invoking tools:
  - 💰 **Pricing Cards:** Real-time hosting/VPS packages.
  - 🛒 **Buy Forms:** In-chat checkout forms linked directly to your CRM.
  - 🌐 **Domain Lookups:** In-chat availability checks.
  - 🎫 **Support Tickets:** Native in-chat ticket creation for technical support.
  - ⭐ **CSAT Ratings:** Interactive star-rating widgets after the conversation.
- **🔌 Easy Website Embedding:** Drop a single `<script>` line into your website to embed a beautiful floating widget out-of-the-box.
- **💸 Cost-Effective AI Routing:** Configured to use **DeepSeek API** by default, delivering GPT-4 level intelligence at ~80% less cost. Fallbacks to OpenAI GPT-4o-mini available.

---

## 🏗️ Architecture Stack

### **Backend (Python / FastAPI)**
- **Framework:** FastAPI
- **Vector Database:** Qdrant
- **Relational Database:** PostgreSQL (Models utilizing SQLAlchemy)
- **AI/LLM Logic:** deepseek-chat + OpenAI SDK
- **Embeddings:** `paraphrase-MiniLM-L3-v2` Local Embeddings Model
- **Services:** RAG Retrieval, MCP Tools executor, Chat History Persistence.

### **Frontend (Next.js / React)**
- **Framework:** Next.js 14 App Router
- **Generative AI:** Vercel AI SDK (React `useChat` + Server `streamText`)
- **Styling:** Custom CSS (vibrant colors, glassmorphism, micro-animations)
- **Embed Strategy:** Dynamic `embed.js` route injection via standard HTML `<script>`.

---

## 📦 Project Structure

```bash
sass-cms/
├── api/                   # Python FastAPI Backend
│   ├── models/            # SQLAlchemy Database Models (PostgreSQL)
│   ├── routers/           # FastAPI Endpoints (/chat, /crm, /kb, /admin)
│   ├── services/          # Business logic: RAG engine, LLM routing, MCP Tools
│   ├── main.py            # API Gateway entry
│   └── requirements.txt
├── chatbot-ui/            # Next.js React Frontend
│   ├── app/
│   │   ├── api/chat/      # Vercel AI SDK Proxy Route
│   │   ├── api/embed/     # Embed.js Generation Route
│   │   └── widget/        # Chatbot UI Page
│   ├── components/        # Generative UI React Components (BuyForm, etc.)
│   └── globals.css        # Premium UI Design System
├── data/                  # Mock Knowledge Base text/files
└── docker-compose.yml     # Local orchestration configuration
```

---

## 🚀 Getting Started (Local Development)

### 1. Prerequisites
- **Docker & Docker Compose** installed.
- **Node.js** v18+ and `npm`.
- A **DeepSeek API Key** (or OpenAI API Key).

### 2. Environment Setup
Create a `.env` file inside the `api/` directory (or the project root depending on docker-compose) using the example template:
```env
POSTGRES_USER=chatbot
POSTGRES_PASSWORD=changeme123
POSTGRES_DB=chatbot_db
DATABASE_URL=postgresql://chatbot:changeme123@postgres:5432/chatbot_db

QDRANT_URL=http://qdrant:6333

DEEPSEEK_API_KEY=sk-xxxx...
```

### 3. Start Backend Services (Docker)
This command will spin up the FastAPI Backend, PostgreSQL DB, and Qdrant Vector DB.
```bash
docker-compose up -d
```
> The API will run on `http://localhost:8000`.

### 4. Start Next.js Frontend
```bash
cd chatbot-ui
npm install
npm run dev
```
> The Next.js widget UI will run on `http://localhost:3001`.

### 5. Test the Widget
To test the floating widget embedding end-to-end, simply double-click the `dummy-website.html` file provided in the root directory and open it with your web browser. A premium chatbot widget should float in the bottom right corner!

---

## 🌍 Widget Integration (For SaaS Tenants)

Embedding the chatbot inside any standard HTML, WordPress, or React app is incredibly simple. Just add this one line of code right before the closing `</body>` tag:

```html
<script src="https://yourdomain.com/embed.js?key=dk_your_tenant_key" defer></script>
```

> The script automatically creates the toggle button and securely wraps the Chat UI inside an `<iframe>`.

---

## 📝 Roadmap

- [x] RAG System & LLM Config
- [x] Multi-tenancy Isolation structure
- [x] Next.js Generative UI Component Implementation
- [x] Database Persistence implementation
- [x] Embed.js Script creation
- [ ] Admin panel (Open WebUI) connection and tenant config UI.
- [ ] Implement production WebSocket/SSE scaling if needed.

## 📄 License
Internal use only.

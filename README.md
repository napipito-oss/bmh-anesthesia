# BMH Anesthesia Command Center

AI-powered anesthesia scheduling and coordination tool for IU Health Ball Memorial Hospital.

## What it does

- **Daily Board**: Load QGenda staffing + cube schedule data
- **Assignments**: AI-generated room assignments based on your department's logic, provider profiles, and surgeon block database
- **2PM Handoff**: Generate the afternoon handoff report (full brief + one-page decision summary)
- **Provider Intel**: Complete profiles for all MDs with strengths, avoidances, care team preferences, late-stay tendencies
- **Surgeon DB**: Block preferences for 45+ surgeons
- **AI Assistant**: Ask anything about today's staffing, assignments, or coverage

---

## Deploy to Vercel (15 minutes)

### Step 1: Get an Anthropic API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Go to **API Keys** and create a new key
4. Copy the key (starts with `sk-ant-...`)

### Step 2: Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) and create a free account
2. Click **Add New → Project**
3. Choose **"Import Git Repository"** — OR — use **"Deploy from template"** and drag/drop this folder
4. If using drag-and-drop: compress this folder to a `.zip` file and upload it

### Step 3: Set your API Key
1. In Vercel project settings, go to **Settings → Environment Variables**
2. Add a new variable:
   - **Name**: `VITE_ANTHROPIC_API_KEY`
   - **Value**: your API key from Step 1
3. Click **Save**

### Step 4: Deploy
1. Click **Deploy**
2. Wait ~60 seconds
3. Your app is live at `your-project-name.vercel.app`

### Step 5: Bookmark it
- Bookmark the URL in Chrome/Edge
- On mobile: use "Add to Home Screen" for an app-like experience
- Share the URL with Jenni

---

## Run locally (optional)

```bash
# Install dependencies
npm install

# Create .env file with your API key
cp .env.example .env
# Edit .env and add your VITE_ANTHROPIC_API_KEY

# Start development server
npm run dev
# Opens at http://localhost:5173
```

---

## How to use it

### Loading a day

**QGenda (Step 1):**
1. In QGenda, go to Reports → Calendar By Task
2. Set date range to today
3. Export as xlsx
4. Open the xlsx, select all (Ctrl+A), copy, paste into the QGenda box
5. Click **Load Staffing**

**Cube Schedule (Step 2):**
1. Open the SharePoint cube file (once you have refresh access)
2. Refresh the pivot table (Data → Refresh All)
3. Select all (Ctrl+A), copy, paste into the Cube Schedule box
4. Click **Load Schedule**

### Assignments
- Assignments auto-generate based on your department's logic
- Override any assignment using the dropdown
- ★ = preferred provider for this room
- ⚠ = flagged provider (wrong skill set or avoidance)
- Red border = conflict detected

### 2PM Handoff
1. Set case status for each room (~1:45pm)
2. Flag any provider situations
3. Click **Generate Handoff Report**
4. Two-layer output: one-page brief (for OR Call physician) + full informational layer

---

## Updating provider/surgeon data

All intelligence is in two files — no code knowledge needed to edit:

- **`src/data/providers.js`** — MD profiles (strengths, avoidances, call preferences, late-stay)
- **`src/data/surgeons.js`** — Surgeon block preferences

Edit these files and redeploy to Vercel (automatic if connected to GitHub).

---

## Security note

This tool handles operational data only — room numbers, case types, surgeon names, provider assignments. **No patient names or MRNs should be entered.** The Anthropic API key is stored as an environment variable in Vercel and never exposed in the browser.

---

## Built for

IU Health Ball Memorial Hospital — Department of Anesthesiology  
Version 1.0 | April 2026

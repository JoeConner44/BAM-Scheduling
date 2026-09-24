# Putting BAM Scheduling online (Vercel + Neon)

It takes about 10 minutes, and you only do it once. After that, every change pushed to the `main` branch goes live automatically.

**You'll need:** the GitHub account that owns `joeconner44/bam-scheduling`. Vercel and Neon accounts are created along the way by signing in with GitHub.

> **Before you start:** make sure the app code is on the `main` branch. It is built on `claude/hopeful-heisenberg-8s85mn`, so merge that pull request first. Vercel publishes `main` as the live site.

## 1. Create the Vercel project

1. Go to **vercel.com** and click **Sign Up**, then **Continue with GitHub**. The free **Hobby** plan is fine for clicking through. Vercel requires **Pro** (about $20/month) once the business uses it for real.
2. Click **Add New… → Project**.
3. Find **bam-scheduling** in the list and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
4. Leave every build setting as it is. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `SITE_PASSWORD` | Any code you choose, e.g. `stripes2026`. Everyone enters it once on the sign-in page. |

   This is the app's own access code, so it works on the free plan. It isn't Vercel's "Password Protection" feature, which is Pro only. You can also add it later under **Settings → Environment Variables**, followed by a **Redeploy**.

5. Click **Deploy**. **This first deploy is expected to fail** with "No database connected". That's fine, because the database gets added in the next step.

## 2. Add the database (Neon)

1. In the new project, open the **Storage** tab.
2. Click **Create Database** (or **Browse Marketplace**), choose **Neon (Serverless Postgres)** and click **Continue**.
3. Accept the defaults: the free plan, and a region near you, such as **US East (Washington, D.C.)**. Click **Create**.
4. On the **Connect a Project** screen:
   - **Project:** `bam-scheduling`
   - **Environments:** Production, Preview (the default is fine)
   - **Create database branch for deployment:** leave both boxes **unchecked**
   - **Custom Prefix:** type `DATABASE`. The default, `STORAGE`, also works because the app finds the connection either way, but `DATABASE` is the standard name.
   - Click **Connect**.
5. This adds the database connection settings (`DATABASE_URL` and friends). You can check under **Settings → Environment Variables**.

## 3. Deploy again

1. Open **Deployments**, click **⋯** on the failed deployment, then **Redeploy**.
2. The build creates the tables and loads the sample data automatically. It takes about 2 minutes.
3. When it finishes, click **Visit**. The address looks like `https://bam-scheduling-xxxx.vercel.app`.

## Using the demo site

- Sign in by entering the access code once, then picking a person. **Pat Owner** or **Dana Dispatcher** opens the office screens. **John**, **Chris** and the others open the phone screen, so try that on your phone.
- The sample dates start from the day the data was loaded. To get a fresh week, sign in as **Pat Owner**, go to **Activity** and click **↺ Reset sample data**. This erases every change.
- Photos taken on the phone are stored in the database, which works for testing. They move to dedicated photo storage in phase 2.

## Switching to real jobs and real people

1. Sign in as **Pat Owner** and go to **Activity**.
2. In the yellow **"This site is showing sample data"** box, type your name and click **Start using real data**, then confirm. This deletes all sample projects, people, equipment and history. It keeps a starter list of skills and job types, and signs you in as the owner under your own name.
3. You land on **People** with a short checklist:
   - Add your crew with **+ Add person**. Each person automatically gets a phone login.
   - Add dispatchers under **Office logins**.
   - Add trucks, trailers and machines on **Equipment**.
   - Add jobs with **+ New project**.
   - Schedule them by dragging on **Schedule**.
4. After this, the sample-data buttons disappear for good, so real data can't be wiped by accident.

**Until phase 2, anyone who knows the access code can sign in as anyone.** Keep the code private and change it by editing `SITE_PASSWORD` under **Environment Variables**, then **Redeploy**. Phase 2 replaces the "pick who you are" sign-in with real passwords (office) and phone number + PIN (crews).

## If something goes wrong

- **Build fails with "No database connected":** step 2 wasn't finished, or the database isn't connected to this project. Check **Storage** and **Settings → Environment Variables**.
- **Sign-in says the code isn't right:** check `SITE_PASSWORD` under **Settings → Environment Variables**. Changing it requires a **Redeploy**.
- Anything else: open the failed deployment and copy the **Build Logs** into a message to Claude.

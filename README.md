# BAM Scheduling

A visual scheduling and dispatch board for pavement striping, sealcoating, thermoplastic and marking crews.

**The schedule is fluid.** Projects, people and equipment are movable pieces. The app shows what's possible, what conflicts and what's at risk. The dispatcher or owner always makes the final call.

See [docs/PLAN.md](docs/PLAN.md) for the full plan and phase status, and [docs/DEPLOY.md](docs/DEPLOY.md) to put it online (Vercel + Neon, about 10 minutes).

## What's in phase 1

| Screen | URL | What it does |
|---|---|---|
| Inbox (scheduler home) | `/` | New jobs waiting for a requested date, alerts (rain, cold, wind, conflicts, jobs that can't fit), what the auto-scheduler changed and why, then today's overview |
| Accept a job (estimator home) | `/jobs/new` | Upload the work order; the app reads job name, address, materials and dates (Claude) for the estimator to check and accept |
| Import from Google Calendar | `/import` | Upload Google Calendar's export (.zip or .ics). The app lists the upcoming jobs it found; untick anything that isn't a job and import. Each event becomes a locked, committed day on the schedule, with crew named in the event or calendar. Safe to run again |
| Settings | `/settings` | Weather limits per type of work, workday hours, frozen days, planning horizon |
| TO DO board | `/todo` | Every open project as a card, with 12 filters, sorting, and grouping by location |
| Scheduling board | `/board` | Drag-and-drop week and day views. Rows for each person and each piece of equipment. Tentative vs committed. Conflict checks run live |
| Project card | `/projects/[id]` | All project fields, schedule, field reports, notes, photos, status history, change history |
| People | `/employees` | Individual employees, skills and certifications, hours, time off ("mark sick today"), week strip |
| Equipment | `/equipment` | Individual units, status, maintenance windows, week strip |
| Field phone screen | `/field` | Today's jobs with big buttons: start, pause, 🚧 job conditions changed, photo, note, mark complete or partial |
| Weather | `/weather` | Rain chance per city per day (entered by hand for now) |
| Activity | `/activity` | Audit log of every change. Overrides are highlighted with the conflicts that were accepted |

## How scheduling works

1. The estimator accepts a job (work order upload).
2. The scheduler enters the customer's requested date.
3. The auto-scheduler (`src/lib/planner`) places the job on the best workable day it can find. It checks:
   - the National Weather Service hourly forecast against the weather limits for that type of work
   - crew availability, skills and time off
   - equipment, and drive time between jobs
   - deadlines and inspection dates

   It also prefers crews already working nearby. It re-plans after every change and on a daily cron.
4. Work a person placed, locked or confirmed is never moved. Anything that goes wrong with it becomes an Inbox alert instead.

## Run it locally

Requirements: Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and DATABASE_URL_UNPOOLED
npx prisma migrate deploy     # create the tables
npm run db:seed               # load the fictional sample data (dates are relative to today)
npm run dev                   # http://localhost:3000
```

Sign in on `/login` by picking a user. In this prototype, "Pat Owner" and "Dana Dispatcher" see the office screens, and each crew member (John, Mike, …) sees the phone screen. Real passwords and phone + PIN sign-in come in phase 2.

## Tests

```bash
npm test          # unit tests for the conflict engine (Vitest)
npm run test:e2e  # the §26 real-world scenarios in a real browser (Playwright)
```

The end-to-end tests use a separate `bam_test` database (override it with `TEST_DATABASE_URL`) and pin "today" to Thu 2026-09-24. If Playwright's bundled browser isn't installed, set `PW_CHROMIUM` to a Chromium executable.

## Code map

- `prisma/schema.prisma`: the relational schema (users, employees, projects, blocks, assignments, audit, weather, …)
- `prisma/seed.ts`: sample data with deliberate conflicts to find
- `src/lib/engine/`: the conflict engine. It's pure TypeScript and shared by the server and the browser
- `src/app/actions/`: server actions. Every scheduling change is re-checked on the server, and nothing that conflicts is saved without an explicit override
- `src/components/board/`: the drag-and-drop board
- `src/components/field/`: the field phone screen
- `e2e/`: Playwright scenario tests

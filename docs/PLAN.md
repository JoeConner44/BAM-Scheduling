# BAM Scheduling — Build Plan

A visual scheduling and dispatch board for pavement striping, sealcoating, thermoplastic and marking crews.

**Guiding rule:** the schedule is fluid. The app shows what's possible, what conflicts and what's at risk. The dispatcher or owner makes the final call.

This document is the plan. It gets reviewed before any application code is written.

---

## 1. Tech stack (recommended)

| Concern | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One codebase for the office board and the field screens. It works well on mobile, and we can wrap it later as a PWA or native shell (Capacitor) without a rewrite. |
| Database | **PostgreSQL** | The spec asks for a relational database. Postgres has solid date and time-range support, and managed hosting is easy (Neon, Supabase, RDS). |
| ORM / migrations | **Prisma** | Typed schema, migrations and seed scripts in one place. |
| Styling | **Tailwind CSS** | Fast, consistent and responsive, with large touch targets for field staff. |
| Drag and drop | **dnd-kit** | Handles touch and mouse and is accessible. It works on tablets, which is where many dispatchers work. |
| Auth | **Auth.js (credentials)** | Office users sign in with email and password. Field employees sign in with phone number and PIN, which is simpler on a truck. |
| Photos | Local disk in dev, S3-compatible storage in prod | Kept behind one small storage interface. |
| Weather (later) | **National Weather Service API** (api.weather.gov) | Free, no key needed, and it covers Georgia. Behind an interface so it can be swapped. |
| Geocoding / travel (later) | Mapbox or Google, behind an interface | For the MVP: straight-line distance × 1.3 road factor ÷ 40 mph average speed. |
| Tests | **Vitest** (engine and unit), **Playwright** (end-to-end scenarios) | Chromium is already available here. |

---

## 2. Core data model idea

The most important modeling decision is to **separate the project from its time on the board**.

```
Project (the job: what, where, how big, how ready)
   └── ScheduleBlock (one piece of time on the board: date, start, end, TENTATIVE/COMMITTED)
         ├── Assignment          (one employee on this block)
         └── EquipmentAssignment (one piece of equipment on this block)
```

- A project can have **many blocks**: multi-day jobs, a return trip after a partial completion, or remaining work split across days.
- A block is a **time range**, not a whole day, so several projects fit in one day (spec §6).
- People and equipment attach to **blocks**, not projects. That is what makes overlap checks exact.
- There are **no crews.** A "crew" is simply whoever is assigned to a block. Later we can add "favorite pairings" as a convenience, never as a fixed structure.
- A project is **never deleted from TO DO** just because it has no block. The TO DO board is "every project not COMPLETE or CANCELLED", whether scheduled or not.
- **Remaining hours** = estimated total − actual worked. The field crew can override it ("need about 2 more hours"). Unscheduled remaining hours = remaining − hours covered by future blocks. When that is > 0, the card shows "2 hrs still to schedule".

---

## 3. Database schema (first draft)

Every table has `id`, `createdAt`, `updatedAt`. **FK** = foreign key.

**Users & people**
- `User`: email, passwordHash or pinHash, **role** (OWNER, DISPATCHER, FIELD), employeeId FK (nullable; a field user is linked to their employee record), active
- `Employee`: name, phone, position, color (for chips on the board), normalStart, normalEnd (e.g. 07:00–15:30), workDays (Mon–Fri), **status** (AVAILABLE, ASSIGNED, OFF, SICK, VACATION, UNAVAILABLE, PARTIAL_DAY, DELAYED), homeBaseLocationId FK, active
- `Skill`: name (e.g. Layout, Thermo Operator, CDL, Line Striper)
- `EmployeeSkill`: employeeId FK, skillId FK, isCertification, expiresOn
- `Availability`: employeeId FK, date, startTime, endTime, kind (EXTRA_AVAILABLE, PARTIAL_DAY). Exceptions to the normal hours.
- `TimeOff`: employeeId FK, startDate, endDate, startTime?, endTime?, **type** (OFF, SICK, VACATION, UNAVAILABLE), note, createdById FK

**Customers & locations**
- `Customer`: name, contactName, phone, email, notes
- `Location`: city, state, lat, lng (city center). **Created automatically** the first time a project address uses a new city, so cities are never hard-coded.

**Projects**
- `Project`: code (e.g. P-1042), customerId FK, name, contactName, contactPhone, contactEmail, street, city, state, zip, lat, lng, locationId FK, jobType, scope, estTotalHours, estCrewSize, earliestDate, preferredDate, deadline, inspectionDate, **priority** (CRITICAL, HIGH, NORMAL, LOW), **weatherSensitivity** (NONE, LOW, HIGH), surfaceReady (bool), customerReady (bool), **status** (TO_DO, READY, TENTATIVE, SCHEDULED, IN_PROGRESS, DELAYED, PARTIALLY_COMPLETE, COMPLETE, WAITING_ON_CUSTOMER, WAITING_ON_CONSTRUCTION, WEATHER_DELAY, CANCELLED), percentComplete, actualHours, remainingHoursOverride (nullable)
- `JobType`: name (Striping, Sealcoating, Thermoplastic, Marking, Layout, …). A table rather than an enum, so the company can add its own.
- `ProjectRequiredSkill`: projectId FK, skillId FK, minCount
- `ProjectRequiredEquipmentType`: projectId FK, equipmentType, quantity. The project needs *a* striping truck, not a specific one; the specific unit is picked on the block.
- `ProjectStatusHistory`: projectId FK, fromStatus, toStatus, changedById FK, reason, at
- `ProjectNote`: projectId FK, blockId FK?, authorId FK, body, kind (NOTE, CONDITION_REPORT, DELAY)
- `ProjectPhoto`: projectId FK, blockId FK?, uploadedById FK, url, caption, takenAt
- `ConditionReport`: projectId FK, blockId FK, reportedById FK, **reason** (CARS_NOT_MOVED, CONSTRUCTION_INCOMPLETE, SURFACE_NOT_READY, LAYOUT_DIFFERENT, SCOPE_CHANGED, EXTRA_PREP, LARGER_THAN_ESTIMATED, ACCESS_BLOCKED, EQUIPMENT_PROBLEM, WEATHER_CHANGED, OTHER), percentComplete, hoursWorked, remainingHours, canProceed (bool), note, at

**Equipment**
- `Equipment`: unitCode (e.g. TRK-1), name (Striping Truck #1), **type** (STRIPING_TRUCK, TRAILER, THERMO_MACHINE, ARROW_BOARD, LAYOUT, SPECIALTY, OTHER), **status** (AVAILABLE, ASSIGNED, MAINTENANCE, OUT_OF_SERVICE), maintenanceNote, currentLocationId FK, color, active
- `EquipmentDowntime`: equipmentId FK, start, end, reason. Scheduled maintenance, so availability is date-aware and not just a status flag.

**Scheduling**
- `ScheduleBlock`: projectId FK, date, startAt, endAt (timestamptz), **state** (TENTATIVE, COMMITTED), plannedHours, sequence, createdById FK, notes. Field progress: startedAt, pausedAt, completedAt, blockStatus (PLANNED, ACTIVE, PAUSED, DONE, CANNOT_PROCEED).
- `Assignment`: blockId FK, employeeId FK, isLead. Unique (blockId, employeeId).
- `EquipmentAssignment`: blockId FK, equipmentId FK. Unique (blockId, equipmentId).
- `SchedulingOverride`: actorId FK, blockId FK, action (MOVE, ASSIGN_EMPLOYEE, ASSIGN_EQUIPMENT, COMMIT…), **conflicts** (JSON snapshot of every warning shown), reason, at
- `AuditLog`: actorId FK, entityType, entityId, action, **before** (JSON), **after** (JSON), reason, at. Used for "Owner moved Walmart – Winder from Friday to Tuesday. Reason: customer deadline."

**Weather**
- `WeatherForecast`: locationId FK, date, precipChance, precipAmount, tempLow, tempHigh, windMph, summary, source, fetchedAt. Cached per location per day.

**Hard vs soft rules at the database level.** The database does **not** enforce "no overlapping assignments". Owner overrides must be able to create a double-booking on purpose. The app enforces the rule instead: no overlap is saved unless the user explicitly overrides, and every override writes a `SchedulingOverride` row. Nothing is ever silently double-booked.

---

## 4. Conflict engine (the heart of the app)

This is one pure TypeScript module, `lib/conflicts`, shared by the browser and the server. The board gives instant feedback while dragging, and the server re-checks before saving. Input: a proposed change plus a snapshot of the relevant schedule. Output: a list of findings.

| Check | Severity | Example message |
|---|---|---|
| Employee overlap | 🔴 Conflict | ⚠️ EMPLOYEE CONFLICT — John is already on Kroger – Athens 8:00–12:00. You're adding him to Publix – Athens 10:00–1:00. |
| Equipment overlap | 🔴 Conflict | ⚠️ EQUIPMENT CONFLICT — Truck #1 is already on … |
| Employee time off / sick / outside normal hours | 🔴 / 🟡 | David is on vacation Tue–Thu. |
| Equipment in maintenance / out of service | 🔴 | Trailer #2 is out of service. |
| Travel gap too short between consecutive blocks for the same person or equipment | 🟡 Warning | ⚠️ POSSIBLE TRAVEL CONFLICT — Athens → Winder ≈ 30 min, gap is 0 min. |
| Missing required skill | 🟡 | No one assigned has "Thermo Operator". |
| Too few people / missing equipment type | 🟡 | Needs 3 people, 2 assigned. Needs a striping truck. |
| After deadline / after inspection | 🔴 / 🟡 | Scheduled Thu; inspection is Wed. |
| Before earliest date / project not ready | 🟡 | Surface not ready. Customer not ready. |
| Weather risk (sensitive job + forecast) | 🟡 | 🌧️ 70% rain in Athens Tuesday. |
| Workload | 🟡 | John is booked 11.5 hrs Monday. |

**Override flow (same everywhere):** make a change, then the engine runs. If there are findings, the app shows a "⚠️ THIS CHANGE AFFECTS" dialog listing the people, equipment, projects, travel and deadlines involved. The choices are **Cancel** or **Move anyway / Assign anyway**, with an optional reason (quick picks: Customer deadline, Inspection, Weather, Urgent call, Other). On save, the app writes a `SchedulingOverride` and an `AuditLog` row.

Permissions: Owner and Dispatcher can override. Field users can never change blocks.

Conflicts are **computed live and never stored as truth**. The dashboard's "Scheduling conflicts" list re-runs the engine over the current schedule, so resolving a conflict anywhere clears it everywhere.

---

## 5. Screens

### 5.1 Dashboard (office)
Today at a glance, as tiles you can click: Scheduled · Tentative · Unassigned projects · Available employees · Employees off · Equipment assigned / available · Active jobs · Delayed jobs · Weather risks · Conflicts. Below the tiles is **⚠️ Jobs at risk**: projects that may miss a deadline or inspection, or that lack people or equipment. Each one shows a one-line reason.

### 5.2 TO DO board
A card grid of every open project (not COMPLETE or CANCELLED). There is a filter bar for location, priority, deadline window, inspection window, job type, duration, crew size, equipment type, readiness, weather sensitivity and status. A **Group by location** toggle puts nearby jobs together (the "we're already in Winder" view).

Each **card** shows: priority stripe · customer – project · city · job type icon · est/remaining hours · crew size · deadline or inspection badges (red when close) · readiness dots (surface / customer) · weather-sensitive icon · % complete bar · schedule state (TO DO / Tentative Tue / Committed Tue).

### 5.3 Scheduling board (main screen)
```
┌──────────────┬────────────────────────────────────────────────────────┐
│ TO DO        │  ◀ Week of Sep 28 ▶   [Day | Week]  [Location filter]  │
│ (filterable, │         Mon 9/28      Tue 9/29 🌧️    Wed 9/30   …      │
│  grouped by  │ PROJECTS lane: blocks for the day, dashed = tentative │
│  location)   │ ─────────── PEOPLE ───────────                         │
│  [card]      │ John   ▮Kroger 8–11▮ ▮Publix 11:30–1▮                  │
│  [card]      │ Mike   ░░ VACATION ░░                                  │
│  [card]      │ ─────────── EQUIPMENT ───────────                      │
│  …           │ Truck#1 ▮Kroger▮ ▮Publix▮                              │
│              │ Trailer#2  ✖ Out of service                           │
└──────────────┴────────────────────────────────────────────────────────┘
```
- **Week view**: day columns. Each person or equipment row shows its blocks as small chips in time order.
- **Day view**: a horizontal time axis (6 AM–7 PM, 15-minute snap). Blocks are drawn to scale, so overlaps and travel gaps are visible.
- **Drag a card from TO DO onto a day or time.** This creates a block (default duration = remaining hours, capped at the workday; default state TENTATIVE).
- **Drag an employee chip or equipment chip onto a block** to assign it. You can also open the block and tick names from a list that shows each person's availability for that slot (✓ free / ✖ busy with what / 🏖 off).
- **Drag a block** to another day or time to move it. Resize the edges to change its length.
- The **Tentative ↔ Committed** toggle is on the block. Tentative is shown dashed or faded; committed is solid.
- Red or yellow badges on blocks show conflicts from the engine. Click one to see why.
- The weather icon in each day header warns when weather-sensitive jobs are exposed.

### 5.4 Project card / detail
All the fields from spec §2, grouped into Customer · Location · Scope & Estimate · Dates · Readiness · Requirements (skills, equipment types) · Progress (%, actual, remaining) · Schedule blocks · Notes · Photos · Status history · Audit trail.

### 5.5 Employee management
A list and form: contact, position, color, skills and certifications, normal hours and days, and a time-off calendar ("Mark off" quick action: Sick today / Vacation range / Partial day). Each person has a "This week" strip showing their assignments.

### 5.6 Equipment management
A list and form: unit code, type, status, location, maintenance windows, and a "This week" strip. A quick action marks a unit out of service. It then shows which upcoming blocks are affected.

### 5.7 Field employee mobile screen
One screen, big buttons, no menus:
```
TODAY — Thu Sep 24
┌──────────────────────────────┐
│ Walmart — Winder             │
│ 8:00 AM – 12:00 PM           │
│ 📍 123 Main St, Winder GA ➜  │  (opens Maps)
│ 👷 John, David               │
│ 🚚 Striping Truck #2         │
│ [ ▶ START JOB ]  [ ⏸ PAUSE ] │
│ [ 🚧 JOB CONDITIONS CHANGED ] │
│ [ 📷 ADD PHOTO ] [ 📝 NOTE ] │
│ [ ✅ MARK COMPLETE ]          │
└──────────────────────────────┘
 Next: Publix — Athens 1:00 PM
```
**Job conditions changed** opens a flow: pick a reason (big tiles) → % complete slider → hours worked → estimated remaining hours → note / photo → "Can we keep working? Yes / No".

**Mark complete** asks: "All done?" If the answer is no, the job becomes a **partial completion**. The project then goes to PARTIALLY_COMPLETE with "65% complete · 2 hrs remaining", stays on the TO DO board, and the dispatcher sees it flagged.

---

## 6. Roles & permissions

| Action | Owner | Dispatcher | Field |
|---|---|---|---|
| View whole schedule / dashboard | ✅ | ✅ | ❌ (own day only) |
| CRUD projects, employees, equipment | ✅ | ✅ | ❌ |
| Create / move / assign blocks | ✅ | ✅ | ❌ |
| Override conflicts | ✅ | ✅ (logged) | ❌ |
| Delete projects, manage users | ✅ | ❌ | ❌ |
| Start / pause / complete own block, report conditions, notes, photos | ✅ | ✅ | ✅ (own blocks only) |

Permissions are enforced **on the server** for every action, not just hidden in the UI.

> Open question: should dispatcher overrides be allowed or need owner approval? The default above allows them and logs them.

---

## 7. Scheduling recommendations ("Help me schedule") — *after the MVP*

Suggestions only; nothing is applied without a click.
1. Take the open projects with unscheduled remaining hours that are ready (or nearly ready).
2. Cluster them by location (same city first, then within about 15 miles).
3. For each day in the next 1–2 weeks and each cluster: are enough skilled people free? Is the needed equipment free? Is the weather OK for sensitive jobs? Do the jobs fit within a workday, including travel?
4. Score each candidate on priority, deadline or inspection urgency, closeness, readiness and how well it fills the day.
5. Show the top suggestions with a plain-language "why". **Apply as tentative** drops them onto the board as dashed blocks, which the dispatcher then adjusts.

---

## 8. Build phases

**Phase 0 — Plan (this document).** Review and answer the open questions.

**Phase 1 — Schema + clickable prototype** (spec §25)
1. Scaffold Next.js, Tailwind, Prisma and Postgres, with lint, typecheck and test scripts.
2. Prisma schema from §3, the first migration, and a **seed script** with the §26 sample data.
3. Build the 7 screens against the seeded database. Read paths are real; drag-and-drop works with the conflict engine running in the browser.
4. Build the conflict engine, with unit tests first.
→ **Checkpoint:** you click through the screens and we adjust the layout and workflow before going deeper.

**Phase 2 — MVP** (spec §24)
Login and roles · full CRUD · block create/move/resize/assign with server-side validation · Tentative/Committed · override dialog, `SchedulingOverride` and `AuditLog` · time off and equipment downtime · field screen actions (start, pause, conditions, partial complete, notes, photo upload) · status history · auto-created locations · travel estimate (straight-line) · responsive or mobile polish.

**Phase 3 — Scenario testing** (spec §26). Each scenario becomes a Playwright test plus a manual script (§9).

**Phase 4 — Later**, once the core is proven: NWS weather integration and the risk panel · real geocoding and drive times · Help me schedule · Jobs at risk scoring · map view · PWA install and offline for field users · notifications (SMS or push when a job moves) · native app wrapper.

---

## 9. Sample data & test scenarios

**Seed data:**
- **6 employees**: John, Mike, David, Jason, Chris, Luis, with different skills.
  - Mike: vacation Tue–Thu.
  - Jason: off Friday.
  - Chris: partial day Monday (off at noon).
- **Equipment**: Striping Truck #1–#3, Trailer #1–#2, Thermo Machine #1. Truck #3 is in maintenance Wednesday.
- **10 projects** across **Athens, Winder and Lawrenceville**: Kroger, Publix, Chick-fil-A, Walmart, Home Depot, a school lot, a church lot, and so on. They cover a mix of job types, priorities and weather sensitivity. Some have deadlines and inspections this week.
- A pre-built week with **3 projects on one day** (the spec §6 Monday example). It includes **one deliberate equipment double-booking** and **one tight travel gap** (Athens 8–11 → Winder 11–1).

**Scenarios, each with an expected outcome:**
1. **Moving a project.** Drag Kroger from Mon to Tue. The block moves and its assignments come along. They are re-checked, and an audit row is written.
2. **Assigning employees.** Add David to Publix. He shows on his row and the availability list updates.
3. **Employee conflict.** Add John to two overlapping blocks. The EMPLOYEE CONFLICT dialog shows both time ranges. Cancel changes nothing; Override saves and logs.
4. **Equipment conflict.** Same as scenario 3 for Truck #1.
5. **Moving a project after a conflict.** Move one of the conflicting blocks to a free slot. The conflict badge clears everywhere.
6. **Marking someone off.** Mark John sick today. Every block he's on today is flagged, and the dashboard shows "Employees off: 1" and the affected jobs.
7. **Partial completion.** The field user reports 60% done and 2 hours remaining. The project goes to PARTIALLY_COMPLETE, stays on TO DO showing "2 hrs to schedule", and the dispatcher schedules the remainder as a new block.
8. **Urgent project.** Add a CRITICAL project due tomorrow. It appears at the top of TO DO with a red deadline badge. It is dropped onto a full day, and the override dialog lists everyone affected.
9. **Weather change.** Set rain for Athens on Tuesday (a manual forecast entry in the MVP). The day header shows 🌧️ and the weather-sensitive Athens jobs are listed. The dispatcher moves some of them. Nothing moves automatically.

---

## 10. Decisions I'll make unless you say otherwise

1. **Stack**: the one in §1 (Next.js + Postgres + Prisma).
2. **Field login**: phone number + 4–6 digit PIN.
3. **Workday**: 7:00 AM–5:30 PM board window, 15-minute snap, default travel speed 40 mph with a 1.3 road factor.
4. **Double-booking**: never silent. Owner and Dispatcher can override with a logged reason. Field users can't schedule.
5. **Weather in the MVP**: a manual or mock forecast table, with the real NWS API in Phase 4.
6. **Hosting**: to be decided. Built to run anywhere Node and Postgres run (e.g. Vercel + Neon, or a single VPS).

Next step after approval: Phase 1, the scaffold, schema, seed and clickable prototype of the 7 screens.

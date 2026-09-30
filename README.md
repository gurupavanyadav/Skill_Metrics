# Kaushal Outcome Platform - SIH26135

[![Problem Statement](https://img.shields.io/badge/Problem%20Statement-26135-blue.svg)](#)
[![Organization](https://img.shields.io/badge/Organization-Government%20Of%20Maharashtra-orange.svg)](#)

## Overview

The **Kaushal Outcome Platform** is a longitudinal skilling-outcomes and impact-measurement system designed to track employment outcomes, skill gaps, and the impact of skilling initiatives. It is built for the **Government of Maharashtra** (Maharashtra State Innovation Society, Department of Skills, Employment, Entrepreneurship and Innovation).

Training systems frequently capture enrolment, attendance, assessment, and certification, but reliable information on long-term livelihood outcomes (employment, self-employment, retention, wage progression, etc.) is often incomplete. This platform solves the challenge of establishing a credible, low-burden, and privacy-conscious outcome tracking system.

## Key Features

- **Consent-Based Trainee Records**: Persistent, privacy-conscious trainee identity management.
- **Outcome Timeline**: Unified trainee timeline linking training with placement and employment signals (Employment, Self-Employed, Apprenticeship).
- **Automated & Assisted Follow-ups**: Scheduled workflows for SMS/WhatsApp/IVR and an operator/call-centre interface for unresolved cases.
- **Verification Engine**: Employer verification workflows to validate placement data and evidence.
- **Longitudinal Dataset**: Tracking wage progression (salary snapshots over time) and retention progression (30/90/180/365-day employment states).
- **Kaushal Lens (Analytics & Intelligence)**:
  - **Cohort & Course Analysis**: Compare different trainee cohorts and evaluate course/trade outcomes.
  - **Provider & District Analysis**: Track training-provider performance and map geographic outcomes.
  - **Skill Gap Analysis**: Compare training supply against labor demand.
  - **Attrition & Non-Placement Tracking**: Capture structured reasons for dropouts or non-placement.
- **Policy Intelligence**: Aggregate policy dashboards for resource allocation and evidence-based decision-making.

## System Architecture

The platform aggregates signals from trainees, employers, and programme data, passing them through an Identity & Consent layer to build a comprehensive **Outcome Timeline**. This timeline feeds into a **Verification Engine**, producing a robust **Longitudinal Dataset**. The data is then analyzed by the **Kaushal Lens** analytics engine to provide actionable **Policy Intelligence**.

## Technology Stack

The project is structured as a monorepo containing the following core services:

- **Backend (`/backend`)**
  - **Runtime & Framework**: Node.js, Express.js
  - **Database & ORM**: Prisma ORM
  - **Security**: JWT, bcryptjs
  - **Testing**: Jest, Supertest

- **Operator Dashboard (`/frontend-operator`)**
  - **Framework**: React 19, Vite
  - **Purpose**: Interface for assisted follow-ups, employer validation, and comprehensive administrative analytics.

- **Trainee Portal (`/frontend-trainee`)**
  - **Framework**: React 19, Vite
  - **Purpose**: Designed for trainee interaction, consent management, and self-reporting of outcomes.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- Database (PostgreSQL/MySQL as configured in your Prisma schema)

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd SIH26135
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   
   # Setup your environment variables
   # cp .env.example .env (and configure your DATABASE_URL)
   
   # Run Prisma migrations to setup the database schema
   npx prisma generate
   npx prisma migrate dev
   
   # Start the backend server
   npm start
   ```

3. **Frontend - Operator Setup**
   ```bash
   cd ../frontend-operator
   npm install
   npm run dev
   ```

4. **Frontend - Trainee Setup**
   ```bash
   cd ../frontend-trainee
   npm install
   npm run dev
   ```

## Documentation

Refer to the `/docs` directory for detailed project specifications:
- `Problem_Statement.MD` - Original SIH problem description and scope.
- `PRD.md` - Product Requirements Document mapping requirements to system features.
- `Final_Architechture_Model.txt` - High-level system data flow and architecture.

## License
ISC License

## Git and environment safety

Before running the project locally, copy the `.env.example` files to `.env` and configure local values. Never commit `.env`, database dumps, logs, uploads, archives, or real trainee data. The partner ingestion key is read from `PARTNER_API_KEY`; it is intentionally not stored in source code. See [SECURITY.md](SECURITY.md) for the pre-push checklist.

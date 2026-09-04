FROM node:24-alpine
WORKDIR /app
COPY services/demo-dashboard/package*.json ./
RUN npm ci --omit=dev
COPY services/demo-dashboard/src ./src
COPY services/demo-dashboard/public ./public
COPY services/demo-dashboard/test ./test
COPY services/demo-dashboard/scripts ./scripts
COPY scripts ./project-scripts
COPY database/migrations ./database/migrations
COPY .env.example ./.env.example
COPY .env.phase7-outreach.example ./.env.phase7-outreach.example
COPY rules ./rules
COPY .agents ./.agents
COPY skills.lock.json ./skills.lock.json
ENV DPV_RULES_DIR=/app/rules
ENV DPV_PROJECT_ROOT=/app
USER node
EXPOSE 3000
CMD ["npm", "start"]

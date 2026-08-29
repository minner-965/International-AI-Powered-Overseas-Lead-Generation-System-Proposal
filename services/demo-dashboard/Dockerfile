FROM node:24-alpine
WORKDIR /app
COPY services/demo-dashboard/package*.json ./
RUN npm ci --omit=dev
COPY services/demo-dashboard/src ./src
COPY services/demo-dashboard/public ./public
COPY services/demo-dashboard/test ./test
COPY rules ./rules
ENV DPV_RULES_DIR=/app/rules
USER node
EXPOSE 3000
CMD ["npm", "start"]

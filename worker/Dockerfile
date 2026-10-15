FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN cp -r /root/.cache/ms-playwright /opt/browsers && chmod -R a+rX /opt/browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers HOST=0.0.0.0 PORT=4021 DATA_DIR=/data
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 4021
CMD ["node","server.mjs"]


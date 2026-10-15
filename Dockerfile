FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]

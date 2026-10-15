FROM node:22-slim
RUN npm install -g opencode-ai
WORKDIR /app
COPY shim.mjs ./shim.mjs
COPY start.sh ./start.sh
RUN chmod +x ./start.sh
EXPOSE 8080
CMD ["./start.sh"]

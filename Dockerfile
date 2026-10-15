FROM node:22-slim
RUN npm install -g opencode-ai
WORKDIR /app
EXPOSE 4096
CMD ["sh", "-c", "opencode serve --port ${PORT:-4096} --hostname 0.0.0.0"]

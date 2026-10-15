FROM node:22-slim
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:${PATH}"
WORKDIR /app
EXPOSE 4096
CMD ["sh", "-c", "opencode serve --port ${PORT:-4096} --hostname 0.0.0.0"]

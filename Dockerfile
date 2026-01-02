# --------------------------
# 1) Build stage (Node)
# --------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm install

# Copy the rest of the project (including index.html, public/, src/, etc.)
COPY . .

# Build production assets
RUN npm run build


# --------------------------
# 2) Nginx serve stage
# --------------------------
FROM nginx:alpine

# Copy built Vite dist/ folder
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

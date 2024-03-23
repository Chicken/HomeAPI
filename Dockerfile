FROM node:18-alpine

WORKDIR /app

RUN apk update && \
    apk upgrade && \
    apk add dumb-init

COPY package.json yarn.lock ./

RUN yarn --production=true --frozen-lockfile --link-duplicates

COPY src/ src/

USER node

ENTRYPOINT [ "/usr/bin/dumb-init", "--" ]
CMD [ "yarn", "start" ]

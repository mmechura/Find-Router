# Variant 2, Milestone 1 (see docs/ARCHITECTURE.md): builds a self-hosted
# BRouter instance (https://github.com/abrensch/brouter) with find-router's
# own tuned profiles and the segment data for its home region baked in.
#
# Adapted from BRouter's own official Dockerfile (repo root, abrensch/brouter)
# - the only differences are cloning the upstream source instead of a local
# checkout, using find-router's profiles/ instead of (in addition to)
# BRouter's stock ones, and baking the segment tile into the image (see the
# comment above the ADD line below for why).

# ---- Build stage: clone and build BRouter itself ----
FROM gradle:jdk17-jammy AS build
WORKDIR /tmp/brouter
# Tracks master for now - pin to a specific release tag/commit here once
# Milestone 1's profiles/tuning have stabilized, for reproducible rebuilds.
RUN git clone --depth 1 https://github.com/abrensch/brouter.git .
RUN ./gradlew clean build

# ---- Runtime stage ----
FROM openjdk:17.0.1-jdk-slim

RUN mkdir /customprofiles

WORKDIR /app
COPY --from=build /tmp/brouter/brouter-server/build/libs/brouter-*-all.jar /app/brouter.jar
COPY --from=build /tmp/brouter/misc/scripts/standalone/server.sh /app/server.sh
COPY --from=build /tmp/brouter/misc/* /profiles2/
RUN sed -i 's/\r$//' /app/server.sh && chmod +x /app/server.sh

# find-router's own tuned profiles (bike-road-flat/bike-road-hilly, see
# profiles/*.brf) take precedence over the stock set above via
# CUSTOMPROFILESPATH - Milestone 1 only ever asks for these two by name.
COPY profiles/*.brf /customprofiles/

# Segment data baked into the image at build time rather than mounted from a
# volume: Milestone 1's cost decision (docs/ARCHITECTURE.md) runs this on
# Render's free tier, which has no persistent disk to mount one from. This
# single 5x5 degree tile (15-20E, 45-50N) covers the Beskydy/Jablunkov
# CZ/PL/SK border area Milestone 1 validates against - see
# brouter/README.md for how it was picked and how to add more tiles for a
# wider area later.
ADD https://brouter.de/brouter/segments4/E15_N45.rd5 /segments4/E15_N45.rd5

ENV CLASSPATH=/app/brouter.jar \
    SEGMENTSPATH=/segments4 \
    PROFILESPATH=/profiles2 \
    CUSTOMPROFILESPATH=/customprofiles

EXPOSE 17777

CMD ["sh", "-c", "/app/server.sh"]

# syntax=docker/dockerfile:1
# Build the Ktor app into a runnable distribution, then run it on a slim JRE.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
# Copy build files before sources so a source-only change doesn't bust the layers
# below. The cache mount persists the Gradle home (downloaded deps + wrapper) across
# builds, so rebuilds recompile instead of re-downloading everything.
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
COPY server/build.gradle.kts ./server/
COPY server/src ./server/src
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x ./gradlew && ./gradlew --no-daemon :server:installDist

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/server/build/install/komreg-parameterfil-poc-backend ./
# Run as a non-root user (least privilege).
RUN useradd --system --user-group --no-create-home appuser \
    && chown -R appuser:appuser /app
USER appuser
# Container-aware heap: the JVM defaults to only 25% of the container's memory limit.
# Use most of what the pod is given, leaving headroom for metaspace/threads/buffers.
# (Gradle's start script picks JAVA_OPTS up.)
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0"
EXPOSE 8080
CMD ["./bin/komreg-parameterfil-poc-backend"]

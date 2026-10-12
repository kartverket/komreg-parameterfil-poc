plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    // Formatting is a tool's job, not a reviewer's. Style comes from the repo-root
    // .editorconfig; `./gradlew ktlintFormat` fixes, and ktlintCheck runs as part of
    // `build`. intellij_idea style was picked to match what was already written here.
    alias(libs.plugins.ktlint)
    application
}

group = "no.komreg"
version = "0.1.0"

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.compression)
    implementation(libs.ktor.server.call.logging)
    implementation(libs.ktor.server.call.id)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.body.limit)
    implementation(libs.ktor.server.request.validation)
    implementation(libs.ktor.server.di)
    // HTTP client, shared by the geodata proxy (Geonorge/Kartverket) and the komreg-backend handoff.
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.cio)
    implementation(libs.hikaricp)
    implementation(libs.postgresql)
    implementation(libs.flyway.core)
    // Flyway's Postgres support is a separate module since Flyway 10 (ServiceLoader-found).
    runtimeOnly(libs.flyway.postgresql)
    implementation(libs.logback.classic)

    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
    // Fake upstream for the geo proxy tests.
    testImplementation(libs.ktor.client.mock)
    // Real Postgres in Docker — the code uses jsonb/interval, so no in-memory stand-in.
    testImplementation(libs.testcontainers.postgresql)
}

application {
    applicationName = "komreg-parameterfil-poc-backend"
    mainClass.set("io.ktor.server.netty.EngineMain")
}

kotlin { jvmToolchain(25) }

tasks.test { useJUnitPlatform() }

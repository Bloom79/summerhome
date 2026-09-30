import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Desktop tool to try the colorcore pipeline on real photos before the
// Android app exists. Uses only the JDK (javax.imageio).
plugins {
    kotlin("jvm")
    application
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":colorcore"))
}

application {
    mainClass.set("dev.colorgap.cli.MainKt")
    applicationDefaultJvmArgs = listOf("-Djava.awt.headless=true")
}

tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}

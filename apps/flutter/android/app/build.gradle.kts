import java.util.Properties
import java.io.FileInputStream
plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}
val signingFile = rootProject.file("key.properties")
val signingProperties = Properties()
if (signingFile.exists()) signingProperties.load(FileInputStream(signingFile))
val reviewBuild = providers.gradleProperty("reviewBuild").orNull == "true"
if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) } && !signingFile.exists() && !reviewBuild) {
    throw GradleException("Release signing is required. Add android/key.properties. For a local review APK only, set ORG_GRADLE_PROJECT_reviewBuild=true.")
}
android {
    namespace = "rw.maisonmunezero.maison_munezero"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = JavaVersion.VERSION_17.toString() }
    defaultConfig {
        applicationId = "rw.maisonmunezero.maison_munezero"
        minSdk = 23
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }
    signingConfigs {
        if (signingFile.exists()) create("release") {
            keyAlias = signingProperties["keyAlias"] as String
            keyPassword = signingProperties["keyPassword"] as String
            storeFile = file(signingProperties["storeFile"] as String)
            storePassword = signingProperties["storePassword"] as String
        }
    }
    buildTypes {
        release { signingConfig = if (signingFile.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug") }
    }
}
flutter { source = "../.." }

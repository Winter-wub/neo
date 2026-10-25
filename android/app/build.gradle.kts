plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.mochi.companion"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.mochi.companion"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "0.2-native"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013") // org.json ของ Android เป็น stub ใน unit test
}

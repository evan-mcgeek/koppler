import { expect, test } from 'vitest';
import { androidAppId } from './gradle.ts';

const groovy = `
android {
    namespace 'com.acme.shop'
    defaultConfig {
        applicationId "com.acme.shop" // the store id
        minSdk 24
    }
    buildTypes {
        debug {
            applicationIdSuffix ".debug"
        }
        release {
            minifyEnabled true
        }
    }
    flavorDimensions "tier"
    productFlavors {
        free {
            dimension "tier"
            applicationIdSuffix '.free'
        }
        pro {
            dimension "tier"
            applicationId "com.acme.shoppro"
        }
    }
}
`;

const kotlin = `
android {
    namespace = "com.acme.shop"
    defaultConfig {
        applicationId = "com.acme.shop"
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
        }
        create("staging") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".staging"
        }
    }
    flavorDimensions += "tier"
    productFlavors {
        create("free") {
            dimension = "tier"
            applicationIdSuffix = ".free"
        }
    }
}
`;

test('a build type adds its suffix to the app id', () => {
  expect(androidAppId(groovy, 'freeRelease')).toEqual({ id: 'com.acme.shop.free' });
  expect(androidAppId(groovy.replace(/productFlavors \{[\s\S]*?\n {4}\}\n/, ''), 'debug')).toEqual({
    id: 'com.acme.shop.debug',
  });
});

test('a flavor gives its own id, or adds its suffix before the build type', () => {
  expect(androidAppId(groovy, 'proDebug')).toEqual({ id: 'com.acme.shoppro.debug' });
  expect(androidAppId(groovy, 'freeDebug')).toEqual({ id: 'com.acme.shop.free.debug' });
});

test('the Kotlin script form reads the same', () => {
  expect(androidAppId(kotlin, 'freeDebug')).toEqual({ id: 'com.acme.shop.free.debug' });
  expect(androidAppId(kotlin, 'freeStaging')).toEqual({ id: 'com.acme.shop.free.staging' });
});

test('without an applicationId, the namespace is the app id, as Gradle does', () => {
  expect(androidAppId('android {\n  namespace = "com.acme.shop"\n}\n', 'debug')).toEqual({ id: 'com.acme.shop' });
});

test('an id Koppler cannot read for sure asks for mobile.androidPackage instead of guessing', () => {
  const asks = /mobile\.androidPackage/;
  expect(androidAppId(groovy.replace('"com.acme.shop" //', 'appId //'), 'freeDebug').error).toMatch(asks);
  expect(androidAppId(groovy.replace("'.free'", '"$suffix"'), 'freeDebug').error).toMatch(asks);
  // Changed outside the blocks Koppler reads: per variant, in code.
  const variants = `${kotlin}\nandroidComponents { onVariants { it.applicationId.set("com.acme.other") } }\n`;
  expect(androidAppId(variants, 'freeDebug').error).toMatch(asks);
  expect(androidAppId(groovy, 'paidDebug').error).toMatch(asks);
  expect(androidAppId('', 'debug').error).toMatch(asks);
});

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WAFSDKInjectionSampleStack } from '../lib/waf-sdk-injection-sample';

const app = new cdk.App();
new WAFSDKInjectionSampleStack(app, 'WAFSDKInjectionSampleStack', {
  env: { region: 'us-east-1' }
});
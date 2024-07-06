import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as pythonLambda from '@aws-cdk/aws-lambda-python-alpha';
import * as s3objectlambda from 'aws-cdk-lib/aws-s3objectlambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { RemovalPolicy } from 'aws-cdk-lib';

export class WAFSDKInjectionSampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;
    const accessPointName = 'injectaccesspoint';

    // ECS cluster for the backend app (note that docker container built from the backend directory)
    const vpc = new ec2.Vpc(this, 'WAFSDKInjectionSampleVPC', {
      maxAzs: 3
    });

    const cluster = new ecs.Cluster(this, 'WAFSDKInjectionSampleCluster', {
      vpc: vpc
    });

    // S3 Bucket
    const s3Bucket = new s3.Bucket(this, 'WAFSDKInjectionSampleSPA', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Bucket policy
    s3Bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['*'],
        resources: [`${s3Bucket.bucketArn}`, `${s3Bucket.bucketArn}/*`],     
        conditions: {
          'StringEquals': {
            's3:DataAccessPointAccount': accountId
          }
        } 
      }),
    );

    // Deploy frontend application
    new s3deploy.BucketDeployment(this, 'DeployWAFSDKInjectionSampleSPA', {
      destinationBucket: s3Bucket,
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend'), {
          bundling: {
            image: cdk.DockerImage.fromBuild(
              path.join(__dirname, '../../frontend'),
              {}
            )
          }
        })
      ]
    });

    // WAF rule to force challenge completion
    const wafSDKInjectionSampleWebACL = new waf.CfnWebACL(this, 'WAFSDKInjectionSampleWebACL', {
      defaultAction: {
        allow: {}
      },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'WAFSDKInjectionSampleWebACL',
        sampledRequestsEnabled: true
      },
      name: 'WAFSDKInjectionSampleWebACL',
      rules: [
        {
          name: 'ForceInterstitial',
          priority: 0,
          action: { challenge: {} },
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    searchString: 'text/html',
                    fieldToMatch: {
                      singleHeader: { 'Name': 'Accept' }
                    },
                    textTransformations: [
                      {
                        priority: 0,
                        type: 'NONE'
                      }
                    ],
                    positionalConstraint: 'CONTAINS'
                  }
                },
                {
                  byteMatchStatement: {
                    searchString: 'GET',
                    fieldToMatch: {
                      method: {}
                    },
                    textTransformations: [
                      {
                        priority: 0,
                        type: 'NONE'
                      }
                    ],
                    positionalConstraint: 'EXACTLY'
                  }
                },
              ]
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'WAFSDKInjectionSampleWebACLRuleForceInterstitial',
            sampledRequestsEnabled: true
          }
        },
        {
          name: 'TGTBotControl',
          priority: 10,
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesBotControlRuleSet",
              scopeDownStatement: {
                  byteMatchStatement: {
                      fieldToMatch: { uriPath: {} },
                      positionalConstraint: 'STARTS_WITH',
                      searchString: '/api',
                      textTransformations: [
                          {
                              priority: 0,
                              type: 'NONE'
                          }
                      ]
                  }
              },
              managedRuleGroupConfigs: [
                  {
                      awsManagedRulesBotControlRuleSet: { inspectionLevel: 'TARGETED' }
                  }
              ],
              // Avoid CAPTCHA action responses to API calls
              ruleActionOverrides: [
                  {
                      actionToUse : {
                          challenge: {}
                      },
                      name : 'TGT_VolumetricSession'
                  },
                  {
                    actionToUse : {
                        challenge: {}
                    },
                    name : 'TGT_SignalAutomatedBrowser'
                  },
                  {
                    actionToUse : {
                        challenge: {}
                    },
                    name : 'TGT_SignalBrowserInconsistency'
                  }
              ]
            }
          },
          overrideAction: {
            none: {}
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'WAFSDKInjectionSampleWebACLRuleBotControl',
            sampledRequestsEnabled: true
          }
        }
      ]
    });

    // Use a custom resource to get WAF Challenge SDK details
    const serviceToken = cdk.CustomResourceProvider.getOrCreate(
      this,
      'Custom::WAFSDKResourceType',
      {
        codeDirectory: path.join(__dirname, 'waf-sdk-resource'),
        runtime: cdk.CustomResourceProviderRuntime.NODEJS_16_X,
        description: 'Lambda function created by the custom resource provider',
        policyStatements: [
          {
            Effect: 'Allow',
            Action: 'wafv2:GetWebACL',
            Resource: '*'
          }
        ]
      }
    );

    const wafSDKResource = new cdk.CustomResource(
      this,
      'WAFSDKResource',
      {
        resourceType: 'Custom::WAFSDKResourceType',
        serviceToken: serviceToken,
        properties: {
          id: wafSDKInjectionSampleWebACL.attrId,
          name: wafSDKInjectionSampleWebACL.name
        }
      }
    );

    // CloudFront Distribution
    const cfDist = new cloudfront.Distribution(this, 'WAFSDKInjectionSampleDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(s3Bucket),
      },
      defaultRootObject: 'index.html',
      webAclId: wafSDKInjectionSampleWebACL.attrArn
    });
    const cfDistroL1 = cfDist.node.defaultChild as cloudfront.CfnDistribution;

    // Access Point
    const accessPoint = new s3.CfnAccessPoint(this, accessPointName, {
      name: accessPointName,
      bucket: s3Bucket.bucketName,
      policy: {
          "Version": "2012-10-17",
          "Statement": [
              {
                  "Effect": "Allow",
                  "Principal": {
                      "Service": "cloudfront.amazonaws.com"
                  },
                  "Action": "s3:*",
                  "Resource": [
                    `arn:aws:s3:${region}:${accountId}:accesspoint/${accessPointName}`,
                    `arn:aws:s3:${region}:${accountId}:accesspoint/${accessPointName}/object/*`
                  ],
                  "Condition": {
                      "ForAnyValue:StringEquals": {
                          "aws:CalledVia": 's3-object-lambda.amazonaws.com'
                      }
                  }
              }
          ]
      },
    });

    const injectionLambdaRole = new iam.Role(this, 'WAF SDK Injection Sample Lambda', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    injectionLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonS3ObjectLambdaExecutionRolePolicy"));

    const injectionLambda = new pythonLambda.PythonFunction(this, 'WAFSDKInjectionSampleLambda', {
      entry: path.join(__dirname, '../waf-sdk-injection-lambda'),
      runtime: lambda.Runtime.PYTHON_3_10,
      index: 'inject.py',
      handler: 'lambda_handler',
      environment: {
        CHALLENGE_SDK_URL: wafSDKResource.getAttString('challengeSDKURL')
      },
      role: injectionLambdaRole
    });
    injectionLambda.grantInvoke(new iam.ServicePrincipal("cloudfront.amazonaws.com"));

    const objectLambda = new s3objectlambda.CfnAccessPoint(this, "WAFSDKInjectionObjectLambda", {
      name: "waf-sdk-injection-object-lambda",
      objectLambdaConfiguration: {
        supportingAccessPoint: accessPoint.attrArn,
        transformationConfigurations: [{
          actions: ["GetObject"],
          contentTransformation: { AwsLambda: { FunctionArn: injectionLambda.functionArn } }
        }]
      }
    });
    objectLambda.addDependency(accessPoint);

    const objectLambdaPolicy = new s3objectlambda.CfnAccessPointPolicy(this, "WAFSDKInjectionSampleS3ObjectLambdaPolicy", {
      objectLambdaAccessPoint: objectLambda.name!,
      policyDocument: {
          "Version": "2012-10-17",
          "Statement": [
              {
                  "Effect": "Allow",
                  "Principal": {
                      "Service": "cloudfront.amazonaws.com"
                  },
                  "Action": "s3-object-lambda:Get*",
                  "Resource": `arn:aws:s3-object-lambda:${region}:${accountId}:accesspoint/${objectLambda.name}`,
                  "Condition": {
                      "StringEquals": {
                          "aws:SourceArn": `arn:aws:cloudfront::${accountId}:distribution/${cfDist.distributionId}`
                      }
                  }
              }
          ]
      }
    });
    objectLambdaPolicy.addDependency(objectLambda);
    objectLambdaPolicy.addDependency(cfDistroL1);

    const oac = new cloudfront.CfnOriginAccessControl(this, 'WAFSDKInjectionSampleOAC', {
      originAccessControlConfig: {
        name: 'WAFSDKInjectionSampleOAC-AOC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    cfDistroL1.addPropertyOverride("DistributionConfig.Origins.0.OriginAccessControlId", oac.getAtt("Id"));
    cfDistroL1.addPropertyOverride("DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity", '');
    cfDistroL1.addPropertyOverride("DistributionConfig.Origins.0.DomainName", `${objectLambda.attrAliasValue}.s3.${region}.amazonaws.com`);

    const cookieSecret = new secretsmanager.Secret(this, 'WAFSDKInjectionSampleCookieSecret', { generateSecretString: {} });

    // Backend application
    const backendApp = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'WAFSDKInjectionSampleFargateService',
      {
        cluster: cluster,
        cpu: 256,
        desiredCount: 1,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, '../../backend')
          ),
          containerPort: 3000,
          secrets: {
            COOKIE_SECRET: ecs.Secret.fromSecretsManager(cookieSecret)
          },
          environment: {
            COOKIE_DOMAIN: cfDist.domainName
          }
        },
        memoryLimitMiB: 512,
        publicLoadBalancer: true
      }
    );

    cfDist.addBehavior(
      '/api/*',
      new origins.LoadBalancerV2Origin(backendApp.loadBalancer, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY
      }),
      {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_AND_CLOUDFRONT_2022
      }
    );

    new cdk.CfnOutput(this, 'WAFSDKInjectionSampleEndpoint', {
      value: `https://${cfDist.domainName}`
    });
  }
}

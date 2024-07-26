const aws = require('aws-sdk');
const wafv2 = new aws.WAFV2({ region: 'us-east-1' });

exports.handler = async function (event) {
  const webACL = await wafv2.getWebACL({
    Scope: 'CLOUDFRONT', 
    Name: event.ResourceProperties.name,
    Id: event.ResourceProperties.id
  }).promise();
  
  var applicationIntegrationURL = webACL.ApplicationIntegrationURL;

  return {
    Data: {
      challengeSDKURL: applicationIntegrationURL + 'challenge.js'
    }
  };
};

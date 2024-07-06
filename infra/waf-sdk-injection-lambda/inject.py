import boto3
import requests
import os
from botocore.config import Config
from bs4 import BeautifulSoup
s3 = boto3.client('s3', config=Config(signature_version='s3v4'))

def lambda_handler(event, context):
    object_context = event["getObjectContext"]
    
    s3_url = object_context["inputS3Url"]
    
    request_route = object_context["outputRoute"]
    request_token = object_context["outputToken"]
    
    response = requests.get(s3_url)
    
    if (response.status_code == 404):
        s3.write_get_object_response(
            StatusCode=404,
            RequestRoute=request_route,
            RequestToken=request_token)
        return {'status_code': 200} 

    if (response.headers["Content-Type"] != "text/html"):
        s3.write_get_object_response(
            Body=response.content,
            ContentType=response.headers["Content-Type"],
            RequestRoute=request_route,
            RequestToken=request_token)
            
        return {'status_code': 200}  
        
    original_object = response.content.decode("utf-8")
    
    soup = BeautifulSoup(original_object, 'html.parser')
    js_tag = soup.new_tag('script', src=os.environ['CHALLENGE_SDK_URL'], type='text/javascript', defer=None)
    soup.head.append(js_tag)

    s3.write_get_object_response(
        Body=str(soup),
        ContentType='text/html',
        RequestRoute=request_route,
        RequestToken=request_token)

    return {'status_code': 200}
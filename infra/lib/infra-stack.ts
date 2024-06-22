import * as cdk from 'aws-cdk-lib';
import {aws_ec2} from "aws-cdk-lib";
import {SubnetType} from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { aws_ecs as aws_ecs } from 'aws-cdk-lib';
import {Protocol} from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Construct} from 'constructs';
import * as assets from "aws-cdk-lib/aws-ecr-assets";
import * as cr from "aws-cdk-lib/custom-resources";
import * as  aws_msk from "aws-cdk-lib/aws-msk";
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ******* VPC Infrastructure *******
    // Create a VPC
    const vpc = new aws_ec2.Vpc(this, 'my-serverless-kafka-vpc', {
      createInternetGateway: true,
      availabilityZones: this.availabilityZones,
      subnetConfiguration: [
        {
          name: 'public-',
          subnetType: SubnetType.PUBLIC,
        },
        {
          name: 'private-',
          subnetType: SubnetType.PRIVATE_ISOLATED,
        }
      ]
    });

    // Create a route table and associate it with the public subnet(s)
    const routeTable = new aws_ec2.CfnRouteTable(this, 'my-route-table', {
      vpcId: vpc.vpcId
    });

    // add route for outgoing traffic
    new aws_ec2.CfnRoute(this, 'my-default-route', {
      routeTableId: routeTable.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: vpc.internetGatewayId
    });

    // Since we want to deploy MSK and ECR in  a private subnet we need VPC Endpoints
    // in order to access S3, ECR, Cloudwatch
    const s3GatewayEndpoint = vpc.addGatewayEndpoint('s3-endpoint-for-ecr', {
      service: aws_ec2.GatewayVpcEndpointAwsService.S3
    });
    const ecrEndpoints = vpc.addInterfaceEndpoint('ecr-endpoint', {
      service: aws_ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true
    });
    const dkrEndpoints = vpc.addInterfaceEndpoint('dkr-endpoint', {
      service: aws_ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true
    });
    vpc.addInterfaceEndpoint("cloudWatchEndpoint",{
      service: aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS
    })

    // ******* MSK Infrastructure *******
    // Create a default security group
    const myKafkaSG = new aws_ec2.SecurityGroup(this,
        'my-kafka-sg',
        {
            securityGroupName: "my-kafka-sg",
            vpc,
            allowAllOutbound: true,
        }
    );

    // MSK -Serverless
    const mskCluster = new aws_msk.CfnServerlessCluster(this,
        'my-serverless-cluster-cdk',
        {
          clientAuthentication: {sasl: {iam:{enabled: true}}},
          clusterName: "my-serverless-cluster",
          vpcConfigs: [{
            subnetIds: vpc.selectSubnets({subnetType: SubnetType.PRIVATE_ISOLATED}).subnetIds,
            securityGroups: [myKafkaSG.securityGroupId]
          }]
    });

    // get components of MSK cluster ARN
    var components = cdk.Arn.split(mskCluster.attrArn,
       cdk.ArnFormat.SLASH_RESOURCE_NAME);

    // generate MSK topic ARN
    const topicArn = cdk.Stack.of(this).formatArn({
      region: components.region,
      service: components.service,
      account: components.account,
      resource: 'topic',
      resourceName: components.resourceName,
      arnFormat: components.arnFormat,
    });

    // generate MSK group ARN
    const groupArn = cdk.Stack.of(this).formatArn({
      region: components.region,
      service: components.service,
      account: components.account,
      resource: 'group',
      resourceName: components.resourceName,
      arnFormat: components.arnFormat,
    });
    // Call SDK to get MSK bootstrap server urls to provide it to quarkus app
    const mskBootStrapUrls = new cr.AwsCustomResource(this, 'msk-bootstrap-url', {
      onCreate: {
          physicalResourceId: cr.PhysicalResourceId.of('mskBootStrapUrls'),
          service: 'Kafka',
          action: 'getBootstrapBrokers',
          parameters: {
              ClusterArn: mskCluster.attrArn
          }
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
            resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    })
    //add dependency so that sdk call to get bootstrap server url will be made after MSK is created
    mskBootStrapUrls.node.addDependency(mskCluster);
    const bootStrapServerUrls = mskBootStrapUrls.getResponseField("BootstrapBrokerStringSaslIam");

    // ******* ECS Infra *******

    // Create an ECS cluster
    const ecsCluster = new ecs.Cluster(this, 'my-ecs-cluster', {
      vpc,
      clusterName: 'my-ecs-cluster'
    });

    // generate kafka producer app docker image
    const kafka_producer_image = new assets.DockerImageAsset(this, "kafka-producer", {
        directory: '../kafka-producer',
        file: 'docker/Dockerfile.jvm'
    });

    // generate kafka consumer app docker image
    const kafka_consumer_image = new assets.DockerImageAsset(this, "kafka-consumer", {
        directory: '../kafka-consumer',
        file: 'docker/Dockerfile.jvm'
    });

    // Create an ECS task definition with 2 containers (producer and consumer)
    const taskDefinition = new ecs.FargateTaskDefinition(this,
        'my-task-definition');

    // kafka producer container
    const kafka_producer = taskDefinition.addContainer('kafka-producer', {
      portMappings: [{ containerPort: 8080, hostPort: 8080, protocol: Protocol.TCP }],
      image: ecs.ContainerImage.fromDockerImageAsset(kafka_producer_image),
      logging: ecs.LogDrivers.awsLogs({streamPrefix: 'KafkaConsumer'}),
      environment: {
        'KAFKA_BOOTSTRAP_SERVERS': bootStrapServerUrls
      },
      healthCheck: {
        command: [ "CMD-SHELL", "curl -f http://localhost:8080/health || exit 1" ],
        interval: cdk.Duration.seconds(120),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5)
      },
      command: ["java", "-Djava.util.logging.manager=org.jboss.logmanager.LogManager", "-jar", "/deployments/quarkus-run.jar"]
    });

    // kafka consumer container
    const kafka_consumer = taskDefinition.addContainer('kafka-consumer', {
      portMappings: [{ containerPort: 8081, hostPort: 8081, protocol: Protocol.TCP }],
      image: ecs.ContainerImage.fromDockerImageAsset(kafka_consumer_image),
      logging: ecs.LogDrivers.awsLogs({streamPrefix: 'KafkaConsumer'}),
      environment: {
        'KAFKA_BOOTSTRAP_SERVERS': bootStrapServerUrls
      },
      healthCheck: {
          command: [ "CMD-SHELL", "curl -f http://localhost:8081/health || exit 1" ],
          interval: cdk.Duration.seconds(120),
          retries: 3,
          startPeriod: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5)
      },
      command: ["java", "-Djava.util.logging.manager=org.jboss.logmanager.LogManager", "-jar", "/deployments/quarkus-run.jar"]
    });

    //consumer depends on producer container
    kafka_consumer.addContainerDependencies({
      container: kafka_producer,
      // the properties below are optional
      condition: ecs.ContainerDependencyCondition.HEALTHY,
    })

    //add ECS task role to access MSK
    taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
       effect: iam.Effect.ALLOW,
       actions: [
         "kafka-cluster:DescribeCluster",
         "kafka-cluster:AlterCluster",
         "kafka-cluster:Connect"
       ],
        resources: [mskCluster.attrArn]
    }));

    taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions:[
              "kafka-cluster:AlterGroup",
              "kafka-cluster:CreateTopic",
              "kafka-cluster:ReadData",
              "kafka-cluster:DescribeTopic",
              "kafka-cluster:DescribeGroup",
              "kafka-cluster:Connect",
              "kafka-cluster:WriteData"
          ],
          resources: [mskCluster.attrArn + '/*',
              topicArn + '/*/*',
              groupArn + '/*/*']
        }
    ));

    // Create an execution role for the ECS task
    const executionRole: iam.IGrantable = new iam.Role(this, 'my-ecs-execution-role', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    // assign task execution role to ECS task
    taskDefinition.grantRun(executionRole);

    // ECS service section
    // create security group for ECS Fargate Task
    const ecsSG = new aws_ec2.SecurityGroup(this, 'my-fargate-sg',{
        securityGroupName: "Fargate SG",
        vpc: vpc,
        allowAllOutbound: true
      }
    );

    // create security group for network load balancer
    const nlbSG = new aws_ec2.SecurityGroup(this, 'my-nlb-sg',{
        securityGroupName: "NLB SG",
        vpc: vpc,
        allowAllOutbound: true
      }
    );

    // add ingress rule to nlb Security group to allow traffic from outside world to nlb
    nlbSG.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(80),"allowTrafficFromOutsideworldToNLB");
    // add ingress rule to ecs task Security group to allow traffic from nlb to ecs fargate task on port 8080
    ecsSG.addIngressRule(nlbSG,aws_ec2.Port.tcp(8080), "allowTrafficFromnlbToFargateService");
    // add ingress rule to msk Security group to allow traffic from ecs task to MSK
    myKafkaSG.addIngressRule(ecsSG,aws_ec2.Port.allTraffic(), "allowTrafficFromFargateToKafka");

    // create ECS Service
    const ecsService = new ecs.FargateService(this,
        "my-fargate-service", {
            cluster: ecsCluster,
            taskDefinition: taskDefinition,
            assignPublicIp: false,
            serviceName: "my-kafka-producer-consumer-service",
            securityGroups:[ecsSG],
            vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED },
        }
    );

    // ******* NLB Infrastructure *******
    // Create NLB
    const lb = new elbv2.NetworkLoadBalancer(this, "my-ecs-nlb",{
        loadBalancerName: "my-ecs-nlb",
        vpc: vpc,
        internetFacing: true
    });

    //Attach security group nlbSG to nlb
    const cfnlb = lb.node.defaultChild as elbv2.CfnLoadBalancer;
    cfnlb.addPropertyOverride("SecurityGroups", [nlbSG.securityGroupId]);

    // add listener to nlb on port 80
    const listener = lb.addListener("my-ecs-task-listener",{
        port: 80
    });

    // add ECS Service as a target
    listener.addTargets("my-fargate-task-tg", {
        targetGroupName: "my-fargate-task-tg",
        port: 8080,
        targets: [ecsService]
    });

    // print Network LoadBalancer URL
    new cdk.CfnOutput(this, "nlb-url", {
      value: "http://"+lb.loadBalancerDnsName,
      description: "Network LoadBalancer URL"
    });

    //print sample nlb url with complete api path to kafka message producer api
    new cdk.CfnOutput(this, "Produce_Message_API_Url_Format", {
        value: "http://"+lb.loadBalancerDnsName + "/order/{id}/{description}",
        description: "Produce message API URL format"
    });

    //print sample nlb url with complete api path and sample data to kafka message producer api
    new cdk.CfnOutput(this, "Produce_Message_API_Sample", {
        value: "http://"+lb.loadBalancerDnsName + "/order/1/Test_Description",
        description: "Sample URL to produce order item"
    });

  }

  // override availability zone property
  get availabilityZones(): string[] {
    return ['us-east-1a', 'us-east-1b'];
  }
}

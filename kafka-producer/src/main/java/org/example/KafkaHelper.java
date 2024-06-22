package org.example;

import io.quarkus.logging.Log;
import io.smallrye.common.annotation.Identifier;

import org.apache.kafka.clients.admin.*;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;

@ApplicationScoped
public class KafkaHelper {

    @Inject
    @Identifier("default-kafka-broker")
    Map<String, Object> config;
    private AdminClient getAdmin() {
        Map<String, Object> copy = new HashMap<>();
        for (Map.Entry<String, Object> entry : config.entrySet()) {
            if (AdminClientConfig.configNames().contains(entry.getKey())) {
                copy.put(entry.getKey(), entry.getValue());
            }
        }
        return KafkaAdminClient.create(copy);
    }

    public void createTopic(String name){
        AdminClient ac = getAdmin();
        var result = ac.listTopics();
        try {
            var exists = result.names().get().contains("orders");
            if (!exists) {
                Log.infof("%s topic doesn't exists, so creating it", name);
                Collection<NewTopic> topics = new ArrayList<>();
                NewTopic t = new NewTopic(name,1,(short) 1);
                topics.add(t);
                ac.createTopics(topics);
                Log.infof("successfully created topic: %s", name);
            }else{
                Log.infof("topic %s already exists.", name);
            }
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        } catch (ExecutionException e) {
            throw new RuntimeException(e);
        }
    }
}
package org.example;

import io.quarkus.logging.Log;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.inject.Inject;

@ApplicationScoped
public class AppLifecycleBean {

    @Inject
    KafkaHelper kafkaHelper;

    void onStart(@Observes StartupEvent ev) {
        Log.info("The application is starting...");
        Log.info("Check Topic: orders");
        kafkaHelper.createTopic("orders");
        Log.info("start up tasks done");
    }

    void onStop(@Observes ShutdownEvent ev) {
        Log.info("The application is stopping...");
    }

}
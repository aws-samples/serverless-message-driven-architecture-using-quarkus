package org.example;

import io.quarkus.logging.Log;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/health")
public class HealthResource {
    @GET
    public String health(){
        Log.infof("Health check successful");
        return "health check successful";
    }
}

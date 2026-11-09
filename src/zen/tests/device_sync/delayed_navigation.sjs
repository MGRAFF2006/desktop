/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

function handleRequest(request, response) {
  const params = new URLSearchParams(request.queryString);
  const key = "mirror-navigation-" + params.get("id");
  const action = params.get("action");
  if (action === "status") {
    response.write(getState(key) || "waiting");
    return;
  }
  response.processAsync();
  if (action === "release") {
    getObjectState(key, pending => {
      if (pending) {
        pending.setHeader("Content-Type", "text/html", false);
        pending.write(
          "<!doctype html><title>Remote navigation</title><p>Loaded</p>"
        );
        pending.finish();
        setObjectState(key, null);
      }
      setState(key, "released");
      response.write("released");
      response.finish();
    });
    return;
  }
  setObjectState(key, response);
  setState(key, "pending");
}

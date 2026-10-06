file(GLOB_RECURSE files RELATIVE "${CLIENT_DIR}" "${CLIENT_DIR}/*")
list(REMOVE_ITEM files "Data/Platform/Plugins/skymp5-client-settings.txt")
list(SORT files)

set(stamp_input "")
foreach(f IN LISTS files)
  file(SHA256 "${CLIENT_DIR}/${f}" file_hash)
  string(APPEND stamp_input "${f}|${file_hash}\n")
endforeach()
string(SHA256 stamp "${stamp_input}")

set(zip "${OUT_DIR}/skymp-client.zip")
if(EXISTS "${STAMP_FILE}" AND EXISTS "${zip}" AND EXISTS "${OUT_DIR}/version.txt")
  file(READ "${STAMP_FILE}" old_stamp)
  if(old_stamp STREQUAL stamp)
    message(STATUS "publish_client_dist: the client did not change")
    return()
  endif()
endif()

file(MAKE_DIRECTORY "${OUT_DIR}")
set(file_list "${STAMP_FILE}.files")
string(REPLACE ";" "\n" file_list_content "${files}")
file(WRITE "${file_list}" "${file_list_content}\n")

set(tmp "${zip}.tmp")
execute_process(
  COMMAND ${CMAKE_COMMAND} -E tar cf "${tmp}" --format=zip "--files-from=${file_list}"
  WORKING_DIRECTORY "${CLIENT_DIR}"
  RESULT_VARIABLE res
)
if(NOT res EQUAL 0)
  message(FATAL_ERROR "publish_client_dist: zip failed with code ${res}")
endif()

file(SHA256 "${tmp}" hash)
file(RENAME "${tmp}" "${zip}" RESULT rename_res)
if(NOT rename_res EQUAL 0)
  message(FATAL_ERROR "publish_client_dist: cannot replace ${zip} (${rename_res}). A download can hold it open. Build again later.")
endif()
file(WRITE "${OUT_DIR}/version.txt" "${hash}\n")
file(WRITE "${STAMP_FILE}" "${stamp}")
message(STATUS "publish_client_dist: published ${hash}")
